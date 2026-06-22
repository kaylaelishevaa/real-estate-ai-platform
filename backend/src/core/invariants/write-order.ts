/**
 * Write-ordering invariant: chat history is written BEFORE the listing record.
 *
 * In the production system a listing without its originating chat history is an
 * orphan — unauditable, and a sign the pipeline half-failed. The rule is simple
 * and load-bearing: persist the provenance first, verify it landed, and only
 * then create the record. If history is missing, we refuse to write the record
 * at all rather than create an orphan.
 *
 * Pairing this with the content-keyed store also gives idempotent republish for
 * free: committing the same listing twice updates one row. See
 * [[idempotent-republish]].
 */

import type { ParsedListing, ListingStatus } from '../types';
import type { InMemoryListingStore, UpsertOutcome } from '../store/in-memory-listing-store';
import type { ChatMessage, InMemoryChatHistoryStore } from '../store/in-memory-chat-history';
import { listingKey } from '../store/listing-key';

export class WriteOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriteOrderError';
  }
}

export class OrderedListingWriter {
  constructor(
    private readonly history: InMemoryChatHistoryStore,
    private readonly listings: InMemoryListingStore,
  ) {}

  /**
   * Commit a listing: history first, record second.
   * Throws WriteOrderError (and writes NOTHING new to the record store) if there
   * is no chat history to back the record.
   */
  commit(listing: ParsedListing, chatHistory: ChatMessage[], status: ListingStatus): UpsertOutcome {
    const key = listingKey(listing);

    if (!chatHistory || chatHistory.length === 0) {
      throw new WriteOrderError(
        `refusing to write listing "${key}" with no chat history (would create an orphan record)`,
      );
    }

    // 1. History FIRST.
    this.history.append(key, chatHistory);

    // 2. Verify it actually landed before touching the record store.
    if (!this.history.has(key)) {
      throw new WriteOrderError(`chat history for "${key}" did not persist; aborting record write`);
    }

    // 3. Record SECOND — idempotent by key. Drafts and active listings take the
    //    same write path; only the status differs.
    return this.listings.upsert(key, listing, status);
  }
}
