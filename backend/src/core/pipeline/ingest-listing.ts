/**
 * The listing-ingestion pipeline — the clean, composed replacement for the
 * 600-line god-processor.
 *
 * It is nothing but the tested units wired in order:
 *   whitelist (fail closed) → parse with model escalation → validate fields →
 *   write history-before-record (idempotent by listing key).
 *
 * Every step is an independently tested function. The orchestrator holds no
 * business logic of its own, which is exactly why it stays readable.
 */

import type { InboundMessage, ParsedListing, ModelTier } from '../types';
import type { ListingLlmClient } from '../llm/llm-client';
import { filterInbound } from '../intake/message-whitelist';
import { parseWithEscalation } from '../parse/model-escalation';
import { validateListing } from '../parse/field-validation';
import type { ConfidenceReport } from '../parse/confidence';
import { InMemoryListingStore } from '../store/in-memory-listing-store';
import { InMemoryChatHistoryStore, type ChatMessage } from '../store/in-memory-chat-history';
import { OrderedListingWriter } from '../invariants/write-order';

export type IngestStatus = 'rejected' | 'ignored' | 'needs_more_info' | 'written';

export interface IngestResult {
  status: IngestStatus;
  reason?: string;
  tier?: ModelTier;
  confidence?: ConfidenceReport;
  attempts?: Array<{ tier: ModelTier; score: number }>;
  listing?: ParsedListing;
  missing?: string[];
  created?: boolean;
  revision?: number;
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

    // 3. Validate — never write a half-listing.
    const missing = validateListing(listing);
    if (missing.length > 0) {
      return { status: 'needs_more_info', missing, listing, tier, confidence, attempts };
    }

    // 4. Write: history before record, idempotent by listing key.
    const chatHistory: ChatMessage[] = [
      { from: message.from, text, timestamp: message.timestamp },
    ];
    const outcome = this.writer.commit(listing, chatHistory);

    return {
      status: 'written',
      listing,
      tier,
      confidence,
      attempts,
      created: outcome.created,
      revision: outcome.record.revision,
    };
  }
}
