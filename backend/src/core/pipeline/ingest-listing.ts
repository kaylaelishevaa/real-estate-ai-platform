/**
 * The listing-ingestion pipeline — the clean, composed replacement for the
 * 600-line god-processor.
 *
 * It is nothing but the tested units wired in order:
 *   whitelist (fail closed) → parse with model escalation → validate fields →
 *   write history-before-record (idempotent by listing key).
 *
 * An incomplete parse is NOT discarded — it is saved as a `draft` (with the list
 * of missing fields) so the agent's work isn't lost; a complete parse is saved
 * as `active`. A draft never becomes active while required fields are missing.
 *
 * Every step is an independently tested function. The orchestrator holds no
 * business logic of its own, which is exactly why it stays readable.
 */

import type { InboundMessage, ParsedListing, ModelTier, ListingStatus } from '../types';
import type { ListingLlmClient } from '../llm/llm-client';
import { filterInbound } from '../intake/message-whitelist';
import { parseWithEscalation } from '../parse/model-escalation';
import { validateListing } from '../parse/field-validation';
import { sanityCheck, type SanityWarning } from '../parse/sanity-check';
import type { ConfidenceReport } from '../parse/confidence';
import { InMemoryListingStore } from '../store/in-memory-listing-store';
import { InMemoryChatHistoryStore, type ChatMessage } from '../store/in-memory-chat-history';
import { OrderedListingWriter } from '../invariants/write-order';
import { listingKey } from '../store/listing-key';

export type IngestStatus = 'rejected' | 'ignored' | 'written';

export interface IngestResult {
  status: IngestStatus;
  /** When status='written': whether the record is a draft or active. */
  recordStatus?: ListingStatus;
  reason?: string;
  tier?: ModelTier;
  confidence?: ConfidenceReport;
  attempts?: Array<{ tier: ModelTier; score: number }>;
  listing?: ParsedListing;
  missing?: string[];
  /** Advisory plausibility warnings (implausible price/area). Non-blocking. */
  warnings?: SanityWarning[];
  created?: boolean;
  revision?: number;
  /** False when the parse had no property identity to key a draft on. */
  persisted?: boolean;
}

export class ListingIngestPipeline {
  private readonly writer: OrderedListingWriter;

  constructor(
    private readonly llm: ListingLlmClient,
    readonly history = new InMemoryChatHistoryStore(),
    readonly listings = new InMemoryListingStore(),
  ) {
    this.writer = new OrderedListingWriter(history, listings);
  }

  async ingest(message: InboundMessage): Promise<IngestResult> {
    // 1. Fail-closed whitelist.
    const gate = filterInbound(message);
    if (!gate.accepted) return { status: 'rejected', reason: gate.reason };

    // Images are accepted by the gate but carry no listing data on their own.
    if (gate.type !== 'text') {
      return { status: 'ignored', reason: 'image accepted but not a listing message' };
    }

    const text = gate.message.text!;

    // 2. Parse with confidence-based model escalation.
    const { listing, tier, confidence, attempts } = await parseWithEscalation(text, this.llm);

    // 3. Validate. Missing required fields → save as a draft (don't discard the
    //    agent's work); complete → active.
    const missing = validateListing(listing);
    const recordStatus: ListingStatus = missing.length > 0 ? 'draft' : 'active';

    // 3b. Plausibility check — advisory "are you sure?" warnings (never blocks).
    const warnings = sanityCheck(listing);

    // A draft still needs a property identity to be keyed; without one there's
    // nothing to save against.
    if (!listingKey(listing)) {
      return { status: 'written', recordStatus, missing, warnings, listing, tier, confidence, attempts, persisted: false };
    }

    // 4. Write: history before record, idempotent by listing key. Re-ingesting a
    //    more-complete version of the same listing flips draft → active in place.
    const chatHistory: ChatMessage[] = [
      { from: message.from, text, timestamp: message.timestamp },
    ];
    const outcome = this.writer.commit(listing, chatHistory, recordStatus);

    return {
      status: 'written',
      recordStatus: outcome.record.status,
      missing,
      warnings,
      listing,
      tier,
      confidence,
      attempts,
      created: outcome.created,
      revision: outcome.record.revision,
      persisted: true,
    };
  }
}
