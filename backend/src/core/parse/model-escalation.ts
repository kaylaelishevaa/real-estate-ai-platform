/**
 * Confidence-based model escalation: start on the cheapest model, escalate to a
 * stronger one only when the parse is low-confidence.
 *
 * Why this matters for an AI role: most listings are well-formatted template
 * messages that a cheap model parses perfectly. Paying top-tier prices for all
 * of them is waste; using the cheap model on the messy 10% is errors. Escalation
 * spends the expensive model only where it changes the answer. See [[confidence]].
 *
 *   cheap  → most messages (clean templates)
 *   mid    → messy free-form prose
 *   strong → genuinely ambiguous / conflicting
 *
 * Tiers are provider-neutral; the concrete model per tier lives in the adapter.
 */

import { MODEL_TIERS, type ModelTier, type ParsedListing } from '../types';
import type { ListingLlmClient } from '../llm/llm-client';
import { normalizeListing } from './normalize-listing';
import { scoreConfidence, type ConfidenceReport } from './confidence';

export interface ParseResult {
  listing: ParsedListing;
  /** The tier whose output we ultimately accepted. */
  tier: ModelTier;
  confidence: ConfidenceReport;
  /** Every tier we tried, in order — handy for the demo and for cost analysis. */
  attempts: Array<{ tier: ModelTier; score: number }>;
}

export interface EscalationOptions {
  /** Lowest tier to start at (default 'cheap'). */
  startTier?: ModelTier;
  /** Highest tier we're willing to pay for (default 'strong'). */
  maxTier?: ModelTier;
}

/**
 * Run extraction at increasing tiers until confidence clears the threshold or we
 * hit `maxTier`. Returns the best attempt (the highest score seen), so a final
 * escalation that doesn't help never makes the result worse.
 */
export async function parseWithEscalation(
  text: string,
  llm: ListingLlmClient,
  opts: EscalationOptions = {},
): Promise<ParseResult> {
  const start = MODEL_TIERS.indexOf(opts.startTier ?? 'cheap');
  const max = MODEL_TIERS.indexOf(opts.maxTier ?? 'strong');

  const attempts: ParseResult['attempts'] = [];
  let best: ParseResult | null = null;

  for (let i = start; i <= max; i++) {
    const tier = MODEL_TIERS[i];
    const draft = await llm.extract(text, tier);
    const listing = normalizeListing(draft);
    const confidence = scoreConfidence(listing, draft);
    attempts.push({ tier, score: confidence.score });

    if (!best || confidence.score > best.confidence.score) {
      best = { listing, tier, confidence, attempts };
    }
    if (!confidence.shouldEscalate) break; // good enough — stop spending
  }

  // `best` is always set (the loop runs at least once for start ≤ max).
  best!.attempts = attempts;
  return best!;
}
