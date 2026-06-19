import type { RawListingDraft, ModelTier } from '../types';
import type { ListingLlmClient } from './llm-client';
import { templateExtract, freeformEnrich } from './rule-extractor';

/**
 * Deterministic, network-free LLM stand-in.
 *
 * Used by the demo, the eval harness, and every test. It imitates a real model
 * with a deliberate capability gap by tier:
 *   - `haiku`  → template-only extraction (cheap, misses prose)
 *   - `sonnet` → template + free-form enrichment
 *   - `opus`   → same as sonnet (reserved for conflict cases)
 *
 * That gap is what makes `model-escalation` testable offline: a free-form
 * message yields a thin draft at `haiku` (low confidence) and a complete draft
 * at `sonnet`, so the escalation path actually fires.
 */
export class FakeLlmClient implements ListingLlmClient {
  /** Records every (text, tier) call — handy for asserting escalation in tests. */
  readonly calls: Array<{ text: string; tier: ModelTier }> = [];

  async extract(text: string, tier: ModelTier): Promise<RawListingDraft> {
    this.calls.push({ text, tier });
    const base = templateExtract(text);
    if (tier === 'haiku') return base;
    return freeformEnrich(text, base);
  }
}
