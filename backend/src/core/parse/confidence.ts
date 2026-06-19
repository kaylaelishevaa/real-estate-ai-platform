/**
 * Confidence scoring for a parse.
 *
 * Key choice: confidence is computed from the NORMALIZED result and the raw
 * draft by deterministic code — NOT taken from the model's self-reported
 * confidence (models are unreliable narrators of their own certainty). A thin
 * extraction with core fields missing, or a price string the deterministic
 * parser couldn't resolve, scores low and triggers escalation to a stronger
 * model. See [[model-escalation]].
 */

import type { ParsedListing, RawListingDraft } from '../types';
import { parsePrice } from '../extract/price';

export interface ConfidenceReport {
  /** 0..1; higher is better. */
  score: number;
  /** Human-readable signals that lowered the score. */
  reasons: string[];
  /** True when a stronger model should be tried. */
  shouldEscalate: boolean;
}

/** Below this, escalate to the next model tier. */
export const ESCALATION_THRESHOLD = 0.7;

interface Penalty {
  test: (l: ParsedListing, d: RawListingDraft) => boolean;
  weight: number;
  reason: string;
}

const PENALTIES: Penalty[] = [
  { test: (l) => l.tipe_properti == null, weight: 0.3, reason: 'property type unresolved' },
  { test: (l) => l.nama_properti == null, weight: 0.3, reason: 'property name missing' },
  {
    test: (l) => l.harga == null && l.harga_jual == null && l.harga_sewa == null,
    weight: 0.25,
    reason: 'no price',
  },
  { test: (l) => l.tipe_listing == null, weight: 0.15, reason: 'listing type unknown' },
  {
    // The model emitted a price string but deterministic parsing rejected it —
    // a real conflict worth a stronger model's attention.
    test: (l, d) =>
      d.harga != null && typeof d.harga === 'string' && parsePrice(d.harga) == null,
    weight: 0.2,
    reason: 'price string did not parse',
  },
  {
    test: (l, d) => d.owner_phone != null && l.owner_phone == null,
    weight: 0.1,
    reason: 'owner phone invalid',
  },
];

export function scoreConfidence(
  listing: ParsedListing,
  draft: RawListingDraft,
): ConfidenceReport {
  let score = 1;
  const reasons: string[] = [];
  for (const p of PENALTIES) {
    if (p.test(listing, draft)) {
      score -= p.weight;
      reasons.push(p.reason);
    }
  }
  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  return { score, reasons, shouldEscalate: score < ESCALATION_THRESHOLD };
}
