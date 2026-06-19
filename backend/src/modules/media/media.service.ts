import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ImageEnhanceJobPayload } from './image-enhance.processor';


// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const IMAGE_PREFIX = 'listings';
const BROCHURE_PREFIX = 'uploads/brochures';

/** Sizes the frontend requests via getMediaUrl(). */
const RESIZE_WIDTHS = [100, 480, 1080, 1600] as const;

// ---------------------------------------------------------------------------

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue('image-processing') private readonly imageQueue: Queue,
  ) {
    // Strip trailing slash so `${cdnUrl}/${key}` never has double slashes
    this.bucket = config.get<string>('AWS_S3_BUCKET') ?? '';
    this.cdnUrl = (config.get<string>('AWS_CDN_URL') ?? '').replace(/\/$/, '');

    this.s3 = new S3Client({
      region: config.get<string>('AWS_REGION') ?? 'ap-southeast-1',
      endpoint: config.get<string>('AWS_ENDPOINT'),
      forcePathStyle: false,
      credentials: {
        accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID') ?? '',
        secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  // ── POST /media/upload ─────────────────────────────────────────────────────

  /**
   * Process an image into three sizes, upload all to S3, and return URLs.
   * The `url` field points to the large variant (1200 x 800) as the primary.
   *
   * Requires the S3 bucket to allow public reads (via bucket policy or ACL).
   */
  async uploadImage(
    buffer: Buffer,
    mimetype: string,
    enhance = true,
  ): Promise<{
    url: string;
    thumbnail: string;
    medium: string;
    large: string;
  }> {
    if (!ALLOWED_IMAGE_TYPES.has(mimetype)) {
      throw new BadRequestException(`Unsupported image type "${mimetype}"`);
    }

    // Use UUID for unpredictable filenames
    const uuid = randomUUID();
    const originalBaseName = `${uuid}.jpg`;
    const webpBaseName = `${uuid}.webp`;

    // Upload the original (full-size) image as JPEG for backward compatibility
    const originalBuf = await sharp(buffer)
      .jpeg({ quality: 90 })
      .toBuffer();
    const originalKey = `${IMAGE_PREFIX}/${originalBaseName}`;
    await this.putObject(originalKey, originalBuf, 'image/jpeg');

    // Generate and upload resized variants as WebP (100, 480, 1080, 1600)
    // Frontend accesses these as: listings/{size}-{baseName}
    const resizeJobs = RESIZE_WIDTHS.map(async (width) => {
      const resized = await sharp(buffer)
        .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      const key = `${IMAGE_PREFIX}/${width}-${webpBaseName}`;
      return this.putObject(key, resized, 'image/webp');
    });
    await Promise.all(resizeJobs);

    // Enqueue AI enhancement (async — does not block the response)
    if (enhance) {
      await this.enqueueEnhancement(originalKey, originalBaseName, webpBaseName);
    }

    const url = `${this.cdnUrl}/${originalKey}`;
    return {
      url,
      thumbnail: `${this.cdnUrl}/${IMAGE_PREFIX}/100-${webpBaseName}`,
      medium: `${this.cdnUrl}/${IMAGE_PREFIX}/480-${webpBaseName}`,
      large: `${this.cdnUrl}/${IMAGE_PREFIX}/1600-${webpBaseName}`,
    };
  }

  // ── POST /media/brochure/upload ────────────────────────────────────────────

  async uploadBrochure(
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<{ url: string }> {
    if (mimetype !== 'application/pdf') {
      throw new BadRequestException(
        'Only PDF files are accepted for brochures',
      );
    }

    const uuid = randomUUID();
    const key = `${BROCHURE_PREFIX}/${uuid}.pdf`;

    await this.putObject(key, buffer, 'application/pdf');

    return { url: `${this.cdnUrl}/${key}` };
  }

  // ── DELETE /media/delete ───────────────────────────────────────────────────

  async deleteFile(url: string): Promise<void> {
    // Strip CDN base URL to extract the S3 object key
    const prefix = this.cdnUrl + '/';
    const key = url.startsWith(prefix) ? url.slice(prefix.length) : url;

    // Only allow deleting objects under known prefixes to prevent
    // crafted URLs from deleting unrelated S3 objects.
    const ALLOWED_PREFIXES = [IMAGE_PREFIX + '/', BROCHURE_PREFIX + '/'];
    if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      throw new BadRequestException('Cannot delete files outside of allowed paths');
    }

    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  // ── S3 helpers (public for processor access) ─────────────────────────────

  /** Download an object from S3 and return its contents as a Buffer. */
  async getObject(key: string): Promise<Buffer> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    const stream = response.Body;
    if (!stream) throw new Error(`S3 returned empty body for key "${key}"`);

    // @aws-sdk v3 returns a Readable-like stream — collect into a Buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /** Upload a buffer to S3 with public-read ACL. Exposed for the processor. */
  async putObjectPublic(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.putObject(key, body, contentType);
  }

  // ── Enhancement status ───────────────────────────────────────────────────

  private static readonly LISTING_TYPE = 'App\\Models\\Listing';

  /** Extract S3 key from a CDN URL, e.g. "https://cdn.../listings/abc.jpg" -> "listings/abc.jpg" */
  private s3KeyFromUrl(url: string): string {
    const prefix = this.cdnUrl + '/';
    return url.startsWith(prefix) ? url.slice(prefix.length) : url;
  }

  async getEnhancementStatus(listingId: number) {
    const mediaRows = await this.prisma.media.findMany({
      where: {
        mediableType: MediaService.LISTING_TYPE,
        mediableId: listingId,
      },
      orderBy: { ordinal: 'asc' },
    });

    const s3Keys = mediaRows.map((m) => this.s3KeyFromUrl(m.url));

    // Batch-fetch all enhancement records for these keys
    const enhancements = s3Keys.length
      ? await this.prisma.imageEnhancement.findMany({
          where: { s3Key: { in: s3Keys } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    // Build a map: s3Key -> latest status
    const statusMap = new Map<string, string>();
    for (const e of enhancements) {
      // Keep only the latest record per key (ordered desc above)
      if (!statusMap.has(e.s3Key)) {
        statusMap.set(e.s3Key, e.status);
      }
    }

    const data = mediaRows.map((m) => {
      const key = this.s3KeyFromUrl(m.url);
      return {
        url: m.url,
        enhancement: statusMap.get(key) ?? null,
      };
    });

    const summary = {
      total: data.length,
      completed: data.filter((d) => d.enhancement === 'COMPLETED').length,
      pending: data.filter((d) => d.enhancement === 'PENDING').length,
      failed: data.filter((d) => d.enhancement === 'FAILED').length,
      skipped: data.filter((d) => d.enhancement === 'SKIPPED').length,
      unprocessed: data.filter((d) => d.enhancement === null).length,
    };

    return { data, summary };
  }

  async getEnhancementStatusBatch(listingIds: number[]) {
    if (!listingIds.length) return { data: {} };

    // Fetch all media for all requested listings in one query
    const mediaRows = await this.prisma.media.findMany({
      where: {
        mediableType: MediaService.LISTING_TYPE,
        mediableId: { in: listingIds },
      },
    });

    // Group media by listing ID
    const mediaByListing = new Map<number, typeof mediaRows>();
    for (const m of mediaRows) {
      const lid = Number(m.mediableId);
      const arr = mediaByListing.get(lid) ?? [];
      arr.push(m);
      mediaByListing.set(lid, arr);
    }

    // Batch-fetch all enhancement records
    const allS3Keys = mediaRows.map((m) => this.s3KeyFromUrl(m.url));
    const enhancements = allS3Keys.length
      ? await this.prisma.imageEnhancement.findMany({
          where: { s3Key: { in: allS3Keys } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const statusMap = new Map<string, string>();
    for (const e of enhancements) {
      if (!statusMap.has(e.s3Key)) statusMap.set(e.s3Key, e.status);
    }

    // Build per-listing summaries
    const data: Record<string, { total: number; completed: number; pending: number; failed: number; skipped: number } | null> = {};
    for (const lid of listingIds) {
      const media = mediaByListing.get(lid);
      if (!media?.length) {
        data[lid] = null;
        continue;
      }
      const summary = { total: media.length, completed: 0, pending: 0, failed: 0, skipped: 0 };
      for (const m of media) {
        const status = statusMap.get(this.s3KeyFromUrl(m.url));
        if (status === 'COMPLETED') summary.completed++;
        else if (status === 'PENDING') summary.pending++;
        else if (status === 'FAILED') summary.failed++;
        else if (status === 'SKIPPED') summary.skipped++;
      }
      // No enhancement records matched any image -> treat as unprocessed (null)
      const matched = summary.completed + summary.pending + summary.failed + summary.skipped;
      data[lid] = matched > 0 ? summary : null;
    }

    return { data };
  }

  async retryFailedEnhancements(listingId: number) {
    const mediaRows = await this.prisma.media.findMany({
      where: {
        mediableType: MediaService.LISTING_TYPE,
        mediableId: listingId,
      },
    });

    const s3Keys = mediaRows.map((m) => this.s3KeyFromUrl(m.url));
    if (!s3Keys.length) return { retried: 0 };

    const failedRecords = await this.prisma.imageEnhancement.findMany({
      where: { s3Key: { in: s3Keys }, status: 'FAILED' },
    });

    if (!failedRecords.length) return { retried: 0 };

    // Reset status and re-enqueue
    await this.prisma.imageEnhancement.updateMany({
      where: { id: { in: failedRecords.map((r) => r.id) } },
      data: { status: 'PENDING', errorMessage: null },
    });

    await Promise.all(
      failedRecords.map((r) =>
        this.imageQueue.add(
          'enhance-image',
          {
            s3Key: r.s3Key,
            baseName: r.baseName,
            enhancementId: r.id,
          } satisfies ImageEnhanceJobPayload,
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
          },
        ),
      ),
    );

    return { retried: failedRecords.length };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  /** Create a tracking row and enqueue the enhancement job. */
  private async enqueueEnhancement(
    s3Key: string,
    baseName: string,
    webpBaseName?: string,
  ): Promise<void> {
    try {
      const record = await this.prisma.imageEnhancement.create({
        data: { s3Key, baseName, status: 'PENDING' },
      });

      await this.imageQueue.add(
        'enhance-image',
        {
          s3Key,
          baseName,
          webpBaseName: webpBaseName ?? baseName,
          enhancementId: record.id,
        } satisfies ImageEnhanceJobPayload,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    } catch (err) {
      // Enhancement is best-effort — don't fail the upload if enqueue breaks
      this.logger.error(`Failed to enqueue image enhancement: ${err}`);
    }
  }
}
