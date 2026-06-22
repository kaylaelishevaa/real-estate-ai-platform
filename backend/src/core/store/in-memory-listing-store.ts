/**
 * In-memory listing store — the network-free stand-in for the website DB + CRM.
 *
 * Keyed by the content-derived listing key, so `upsert` is idempotent by
 * construction: re-publishing the same listing updates the existing row and
 * reports `created: false` rather than inserting a duplicate. This is the
 * substance behind the idempotent-republish invariant. See [[idempotent-republish]].
 */

import type { ParsedListing, ListingStatus } from '../types';

export interface ListingRecord {
  key: string;
  listing: ParsedListing;
  /** How many times this key has been published (1 = created, >1 = republished). */
  revision: number;
  /** 'draft' while required fields are missing; 'active' once complete. */
  status: ListingStatus;
}

export interface UpsertOutcome {
  record: ListingRecord;
  created: boolean;
}

export class InMemoryListingStore {
  private readonly rows = new Map<string, ListingRecord>();

  has(key: string): boolean {
    return this.rows.has(key);
  }

  get(key: string): ListingRecord | undefined {
    return this.rows.get(key);
  }

  /** Insert a new row, or replace the existing one for this key (no duplicate). */
  upsert(key: string, listing: ParsedListing, status: ListingStatus): UpsertOutcome {
    const existing = this.rows.get(key);
    const record: ListingRecord = {
      key,
      listing,
      revision: existing ? existing.revision + 1 : 1,
      status,
    };
    this.rows.set(key, record);
    return { record, created: !existing };
  }

  /** Remove a listing by key. Returns true if it existed. */
  delete(key: string): boolean {
    return this.rows.delete(key);
  }

  /** Total distinct listings — the assertion target for "no double-create". */
  size(): number {
    return this.rows.size;
  }

  all(): ListingRecord[] {
    return [...this.rows.values()];
  }
}
