import { Injectable } from '@nestjs/common';
import {
  OrderedListingWriter,
  InMemoryListingStore,
  InMemoryChatHistoryStore,
  validateListing,
  type ChatMessage,
  type ParsedListing,
  type ListingRecord,
} from '../../core';

/**
 * Minimal listing write-target for the public extract.
 *
 * In the production system this is backed by MySQL (the website) and the Lark
 * CRM. Here it's an in-memory store so the parser has somewhere to write with no
 * external dependencies. What it preserves are the two invariants that matter:
 *   - write-ordering (chat history before the record), via OrderedListingWriter
 *   - idempotent republish (content-keyed, no double-create)
 */
@Injectable()
export class ListingWriteService {
  private readonly history = new InMemoryChatHistoryStore();
  private readonly listings = new InMemoryListingStore();
  private readonly writer = new OrderedListingWriter(this.history, this.listings);

  /** Commit a listing with its provenance. Throws if history is empty. */
  write(listing: ParsedListing, chatHistory: ChatMessage[]): { record: ListingRecord; created: boolean } {
    // Same rule as the pipeline: an incomplete listing is saved as a draft.
    const status = validateListing(listing).length > 0 ? 'draft' : 'active';
    return this.writer.commit(listing, chatHistory, status);
  }

  count(): number {
    return this.listings.size();
  }
}
