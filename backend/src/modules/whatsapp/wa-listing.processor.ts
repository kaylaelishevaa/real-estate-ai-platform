import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { validateListing, formatMissing } from '../../core';
import { AiParserService } from '../ai/ai-parser.service';
import { MessagingService } from './messaging.service';
import { ListingWriteService } from './listing-write.service';

export interface WaListingJob {
  from: string;
  roomId: string;
  text: string;
  timestamp?: string;
}

/**
 * Slim queue worker for inbound listing broadcasts.
 *
 * It is intentionally thin: parse (with model escalation) → validate → write
 * (history before record, idempotent). Each step is a tested unit from
 * `src/core`. There is no business logic in the worker itself — contrast the
 * original 600-line god-processor this replaced.
 */
@Processor('whatsapp-listing', { concurrency: 5 })
export class WaListingProcessor extends WorkerHost {
  private readonly logger = new Logger(WaListingProcessor.name);

  constructor(
    private readonly parser: AiParserService,
    private readonly writer: ListingWriteService,
    private readonly messaging: MessagingService,
  ) {
    super();
  }

  async process(job: Job<WaListingJob>): Promise<void> {
    const { from, roomId, text, timestamp } = job.data;

    const { listing, tier, confidence } = await this.parser.parse(text);
    this.logger.log(`Parsed ${from} on tier=${tier} confidence=${confidence.score}`);

    const missing = validateListing(listing);
    if (missing.length > 0) {
      await this.messaging.sendText(
        roomId,
        `📋 Data listing diterima, masih kurang:\n\n${formatMissing(missing)}`,
      );
      return;
    }

    // Write-ordering + idempotent republish are enforced inside the writer.
    const { created } = this.writer.write(listing, [{ from, text, timestamp }]);
    await this.messaging.sendText(
      roomId,
      created
        ? `✅ Listing tersimpan: ${listing.nama_properti_normalized} ${listing.unit ?? ''}`
        : `ℹ️ Listing sudah ada — diperbarui (bukan duplikat).`,
    );
  }
}
