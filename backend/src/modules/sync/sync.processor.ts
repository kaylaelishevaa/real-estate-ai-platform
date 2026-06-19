import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SyncService } from './sync.service';
import { SyncLogService } from './sync-log.service';
import type { SyncJobPayload } from './sync.service';

// ---------------------------------------------------------------------------

/**
 * BullMQ worker for the 'listing-sync' queue.
 *
 * Handles two job names:
 *   'sync-listing' — dispatched by SyncService.dispatchSync(); calls the orchestrator.
 *   'test'         — fires a log message (used by the /health endpoint smoke-test).
 *
 * Retry behaviour is configured per-job in SyncService.dispatchSync():
 *   - 3 attempts max
 *   - Exponential backoff starting at 1 s (~1 s, 2 s, 4 s)
 *
 * After all retries are exhausted BullMQ moves the job to its built-in
 * "failed" set, and @OnWorkerEvent('failed') logs the terminal failure.
 * The failure is also persisted to sync_logs by the orchestrator.
 */
@Processor('listing-sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private readonly syncService: SyncService,
    private readonly syncLogService: SyncLogService,
  ) {
    super();
  }

  // ── Job handler ───────────────────────────────────────────────────────────

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'sync-listing': {
        const { listingId, target, action } = job.data as SyncJobPayload;
        this.logger.log(
          `Processing sync job — listing #${listingId} -> ${target} [${action}] ` +
            `(attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
        );
        await this.syncService.syncListing(listingId, target, action);
        break;
      }

      case 'test':
        this.logger.log('Job processed!');
        break;

      default:
        this.logger.warn(`Unhandled job type: ${job.name}`);
    }
  }

  // ── Worker lifecycle events ───────────────────────────────────────────────

  /** Called each time a job attempt fails (including intermediate retries). */
  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    const attemptsLeft = (job.opts.attempts ?? 1) - (job.attemptsMade ?? 0);
    const data = job.data as SyncJobPayload | undefined;

    if (attemptsLeft <= 0) {
      // Terminal failure — all retries exhausted.
      this.logger.error(
        `Job ${job.id} (${job.name}) exhausted all retries — moving to failed set. ` +
          `Error: ${err.message}`,
        err.stack,
      );
    } else {
      this.logger.warn(
        `Job ${job.id} (${job.name}) attempt ${job.attemptsMade} failed ` +
          `(${attemptsLeft} attempt(s) left): ${err.message}`,
      );

      // Log intermediate retry attempts to sync_logs for debugging visibility
      if (data?.listingId && data.target) {
        this.syncLogService
          .createLog({
            listingId: data.listingId,
            target: data.target,
            action: data.action ?? 'unknown',
            status: 'retry',
            errorMessage: `Attempt ${job.attemptsMade} failed: ${err.message}`,
          })
          .catch((logErr) =>
            this.logger.warn(`Failed to log retry attempt: ${logErr}`),
          );
      }
    }
  }

  /** Called when a job completes successfully. */
  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.debug(`Job ${job.id} (${job.name}) completed.`);
  }
}
