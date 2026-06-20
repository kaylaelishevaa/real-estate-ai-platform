import type { RawListingDraft, ModelTier } from '../types';

/**
 * The seam between our pipeline and any LLM provider.
 *
 * The whole system depends only on this interface — never on a provider SDK
 * directly. That is what makes the parser testable offline (the fake below) and
 * what lets `model-escalation` swap tiers without the rest of the code caring.
 *
 * `extract` returns a LOOSE draft. It is deliberately allowed to be wrong or
 * incomplete; deterministic normalization and validation happen downstream.
 */
export interface ListingLlmClient {
  extract(text: string, tier: ModelTier): Promise<RawListingDraft>;
}
