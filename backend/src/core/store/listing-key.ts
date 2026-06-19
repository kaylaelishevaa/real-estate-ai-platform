/**
 * Stable identity for a listing.
 *
 * A listing is uniquely the (property, tower, unit) it describes — not the row
 * id the database happens to assign. Deriving the key from the listing content
 * is what makes republish idempotent: the same broadcast re-sent yields the same
 * key, so it updates in place instead of creating a duplicate. See
 * [[idempotent-republish]].
 */

import type { ParsedListing } from '../types';

function slug(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Build the idempotency key. Uses the normalized (alias-expanded) name so
 * "pakview 15A" and "Pakubuwono View 15A" collapse to the same listing.
 */
export function listingKey(listing: ParsedListing): string {
  const name = slug(listing.nama_properti_normalized ?? listing.nama_properti);
  const tower = slug(listing.tower_name);
  const unit = slug(listing.unit);
  return [name, tower, unit].filter(Boolean).join(':');
}
