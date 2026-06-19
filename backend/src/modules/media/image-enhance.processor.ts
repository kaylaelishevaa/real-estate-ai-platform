import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from './media.service';
import { IMAGE_ENHANCE_PROMPT } from './image-enhance.prompt';

// ---------------------------------------------------------------------------

export interface ImageEnhanceJobPayload {
  /** S3 key of the original image, e.g. "listings/abc-123.jpg" */
  s3Key: string;
  /** Base filename for original JPEG, e.g. "abc-123.jpg" */
  baseName: string;
  /** Base filename for WebP resized variants, e.g. "abc-123.webp". Falls back to baseName for legacy jobs. */
  webpBaseName?: string;
  /** Prisma row ID for status tracking */
  enhancementId: bigint;
}

/** Widths that match MediaService resize variants. */
const RESIZE_WIDTHS = [100, 480, 1080, 1600] as const;

/** Mediable type constant matching the Laravel convention used in the Media table. */
const LISTING_TYPE = 'App\\Models\\Listing';

// ---------------------------------------------------------------------------

@Processor('image-processing', { concurrency: 1 })
export class ImageEnhanceProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageEnhanceProcessor.name);
  private genai: GoogleGenAI | null = null;

  /** Cached default prompt from Settings table. */
  private cachedDefaultPrompt: string | null = null;
  private cachedDefaultPromptAt = 0;
  private static readonly PROMPT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {
    super();

    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genai = new GoogleGenAI({ apiKey });
    }
  }

  // ── Job handler ─────────────────────────────────────────────────────────

  async process(job: Job): Promise<void> {
    if (job.name !== 'enhance-image') {
      this.logger.warn(`Unhandled job type: ${job.name}`);
      return;
    }

    const { s3Key, baseName, webpBaseName, enhancementId } = job.data as ImageEnhanceJobPayload;
    const resizeBaseName = webpBaseName ?? baseName;
    const useWebp = resizeBaseName.endsWith('.webp');

    this.logger.log(
      `Enhancing image "${baseName}" (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    if (!this.genai) {
      throw new Error('GEMINI_API_KEY is not configured — cannot enhance images');
    }

    // ── Look up media record and its listing ────────────────────────────────
    const context = await this.findContextForS3Key(s3Key);

    // ── Check if enhancement is disabled for this media item ──────────────
    if (context && !context.mediaAiEnhanceEnabled) {
      await this.prisma.imageEnhancement.update({
        where: { id: enhancementId },
        data: { status: 'SKIPPED' },
      });
      this.logger.log(`Enhancement skipped for "${baseName}" — disabled on media record`);
      return;
    }

    // ── Resolve prompt: listing -> settings -> hardcoded fallback ───────────
    const prompt = await this.resolvePrompt(context?.listing ?? null);

    // 1. Download original from S3
    const originalBuf = await this.mediaService.getObject(s3Key);

    // 2. Send to Gemini for enhancement
    const enhancedBuf = await this.callGemini(originalBuf, prompt);

    // 3. Overwrite original on S3 (always JPEG)
    const originalJpeg = await sharp(enhancedBuf).jpeg({ quality: 90 }).toBuffer();
    await this.mediaService.putObjectPublic(s3Key, originalJpeg, 'image/jpeg');

    // 4. Generate and overwrite all resized variants (WebP for new uploads, JPEG for legacy)
    const prefix = s3Key.substring(0, s3Key.lastIndexOf('/'));
    const resizeJobs = RESIZE_WIDTHS.map(async (width) => {
      const pipeline = sharp(enhancedBuf)
        .resize(width, undefined, { fit: 'inside', withoutEnlargement: true });
      const resized = useWebp
        ? await pipeline.webp({ quality: 85 }).toBuffer()
        : await pipeline.jpeg({ quality: 85 }).toBuffer();
      const key = `${prefix}/${width}-${resizeBaseName}`;
      const contentType = useWebp ? 'image/webp' : 'image/jpeg';
      return this.mediaService.putObjectPublic(key, resized, contentType);
    });
    await Promise.all(resizeJobs);

    // 5. Mark enhancement as completed
    await this.prisma.imageEnhancement.update({
      where: { id: enhancementId },
      data: { status: 'COMPLETED' },
    });

    this.logger.log(`Enhancement completed for "${baseName}"`);
  }

  // ── Context lookup ───────────────────────────────────────────────────────

  /**
   * Find the media record and its parent listing for an S3 key.
   * Returns the per-image `aiEnhanceEnabled` flag and the listing's prompt.
   */
  private async findContextForS3Key(
    s3Key: string,
  ): Promise<{
    mediaAiEnhanceEnabled: boolean;
    listing: { aiEnhancePrompt: string | null } | null;
  } | null> {
    const media = await this.prisma.media.findFirst({
      where: {
        mediableType: LISTING_TYPE,
        url: { endsWith: s3Key },
      },
      select: { mediableId: true, aiEnhanceEnabled: true },
    });

    if (!media) return null;

    const listing = await this.prisma.listing.findUnique({
      where: { id: media.mediableId },
      select: { aiEnhancePrompt: true },
    });

    return {
      mediaAiEnhanceEnabled: media.aiEnhanceEnabled,
      listing,
    };
  }

  // ── Prompt resolution ───────────────────────────────────────────────────

  /**
   * Resolve which prompt to use:
   * 1. Listing-level custom prompt (if set)
   * 2. Default prompt from Settings table (cached for 5 min)
   * 3. Hardcoded IMAGE_ENHANCE_PROMPT constant
   */
  private async resolvePrompt(
    listing: { aiEnhancePrompt: string | null } | null,
  ): Promise<string> {
    // 1. Listing-level override
    if (listing?.aiEnhancePrompt) {
      return listing.aiEnhancePrompt;
    }

    // 2. Settings table default (with cache)
    const settingsPrompt = await this.getDefaultPromptCached();
    if (settingsPrompt) {
      return settingsPrompt;
    }

    // 3. Hardcoded fallback
    return IMAGE_ENHANCE_PROMPT;
  }

  private async getDefaultPromptCached(): Promise<string | null> {
    const now = Date.now();
    if (
      this.cachedDefaultPrompt !== null &&
      now - this.cachedDefaultPromptAt < ImageEnhanceProcessor.PROMPT_CACHE_TTL_MS
    ) {
      return this.cachedDefaultPrompt;
    }

    const row = await this.prisma.setting.findFirst({
      where: { key: 'image_enhance_prompt' },
    });

    // Cache even if null — so we don't re-query every job in a batch
    this.cachedDefaultPrompt = row?.value ?? null;
    this.cachedDefaultPromptAt = now;
    return this.cachedDefaultPrompt;
  }

  // ── Gemini API call ─────────────────────────────────────────────────────

  private async callGemini(imageBuffer: Buffer, prompt: string): Promise<Buffer> {
    const base64Image = imageBuffer.toString('base64');

    const response = await this.genai!.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Image,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '4:3' },
      },
    });

    // Find the image part in the response
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) {
      throw new Error('Gemini returned no content parts');
    }

    for (const part of parts) {
      if (part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    throw new Error('Gemini response did not contain an image');
  }

  // ── Worker lifecycle events ─────────────────────────────────────────────

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    const attemptsLeft = (job.opts.attempts ?? 1) - (job.attemptsMade ?? 0);
    const { baseName, enhancementId } = job.data as ImageEnhanceJobPayload;

    if (attemptsLeft <= 0) {
      this.logger.error(
        `Enhancement for "${baseName}" exhausted all retries: ${err.message}`,
        err.stack,
      );

      // Mark as failed in DB — original images remain untouched
      await this.prisma.imageEnhancement
        .update({
          where: { id: enhancementId },
          data: {
            status: 'FAILED',
            errorMessage: err.message.slice(0, 2000),
          },
        })
        .catch((dbErr) =>
          this.logger.warn(`Failed to update enhancement status: ${dbErr}`),
        );
    } else {
      this.logger.warn(
        `Enhancement for "${baseName}" attempt ${job.attemptsMade} failed ` +
          `(${attemptsLeft} left): ${err.message}`,
      );
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.debug(`Job ${job.id} (${job.name}) completed.`);
  }
}
