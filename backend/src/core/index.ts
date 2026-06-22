/**
 * Public surface of the framework-agnostic listing-parser core.
 *
 * The demo, the eval harness, the tests, and the NestJS adapters all import from
 * here. Nothing in `core/` depends on NestJS, Prisma, or the network — that is
 * what lets the eval and demo run with no DB and no API key.
 */

export * from './types';

// Deterministic extractors
export { parsePrice } from './extract/price';
export { normalizePhone62, formatPhoneDisplay, phoneDigits, isValidPhone } from './extract/phone';
export { cleanName } from './extract/name';
export { resolveProperty } from './extract/property-types';
export { splitTower, parseUnit, extractOwnerFromParens } from './extract/tower';
export {
  normalizeCondition,
  normalizeListingType,
  normalizeChannel,
  bedroomEnum,
  floorZone,
  normalizePropertyType,
} from './extract/enums';

// Parse pipeline
export { normalizeListing } from './parse/normalize-listing';
export { validateListing, formatMissing } from './parse/field-validation';
export { sanityCheck, pricePerSqm, type SanityWarning } from './parse/sanity-check';
export { scoreConfidence, ESCALATION_THRESHOLD, type ConfidenceReport } from './parse/confidence';
export { parseWithEscalation, type ParseResult } from './parse/model-escalation';

// LLM seam
export type { ListingLlmClient } from './llm/llm-client';
export { FakeLlmClient } from './llm/fake-llm-client';
export { OpenAiLlmClient } from './llm/openai-llm-client';

// Intake
export { filterInbound, ALLOWED_MESSAGE_TYPES, type WhitelistResult } from './intake/message-whitelist';

// Store + invariants
export { listingKey } from './store/listing-key';
export { InMemoryListingStore, type ListingRecord } from './store/in-memory-listing-store';
export { InMemoryChatHistoryStore, type ChatMessage } from './store/in-memory-chat-history';
export { OrderedListingWriter, WriteOrderError } from './invariants/write-order';

// Orchestrator
export { ListingIngestPipeline, type IngestResult } from './pipeline/ingest-listing';
