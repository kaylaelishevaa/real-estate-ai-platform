import Anthropic from '@anthropic-ai/sdk';
import type { RawListingDraft, ModelTier } from '../types';
import type { ListingLlmClient } from './llm-client';

/**
 * Real Anthropic-backed extractor. OPTIONAL — the demo, eval, and tests all run
 * on FakeLlmClient with zero network. This adapter exists so the same pipeline
 * can run against live Claude by setting ANTHROPIC_API_KEY.
 *
 * The escalation tiers map to real models, cheapest → strongest:
 *   haiku  → claude-haiku-4-5   ($1 / $5  per MTok)
 *   sonnet → claude-sonnet-4-6  ($3 / $15 per MTok)
 *   opus   → claude-opus-4-8    ($5 / $25 per MTok)
 *
 * We only ask the model for a LOOSE draft (structured-output JSON). All
 * normalization, validation, and the price math live in deterministic code —
 * the model is never trusted with a final answer.
 */
const TIER_MODEL: Record<ModelTier, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
};

const SYSTEM_PROMPT =
  'You extract real-estate listing fields from free-form bilingual ' +
  '(Indonesian/English) WhatsApp messages sent by property agents. ' +
  'Return ONLY the raw fields you can find. Do not normalize prices or phone ' +
  'numbers — return them as written. Use null for anything not present. ' +
  'Channel ("Jalur") is Direct or Cobroke.';

// JSON Schema describing the loose draft. Keys mirror RawListingDraft.
const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipe_properti: { type: ['string', 'null'] },
    nama_properti: { type: ['string', 'null'] },
    unit: { type: ['string', 'null'] },
    tipe_listing: { type: ['string', 'null'] },
    channel: { type: ['string', 'null'] },
    harga: { type: ['string', 'null'] },
    harga_jual: { type: ['string', 'null'] },
    harga_sewa: { type: ['string', 'null'] },
    kamar_tidur: { type: ['string', 'null'] },
    kamar_mandi: { type: ['string', 'null'] },
    luas_bangunan: { type: ['string', 'null'] },
    luas_tanah: { type: ['string', 'null'] },
    lantai: { type: ['string', 'null'] },
    kondisi: { type: ['string', 'null'] },
    sertifikat: { type: ['string', 'null'] },
    owner_name: { type: ['string', 'null'] },
    owner_phone: { type: ['string', 'null'] },
    tower_name: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
  required: [],
} as const;

export class AnthropicLlmClient implements ListingLlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extract(text: string, tier: ModelTier): Promise<RawListingDraft> {
    const response = await this.client.messages.create({
      model: TIER_MODEL[tier],
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      messages: [{ role: 'user', content: text }],
    } as any);

    const block = response.content.find((b: any) => b.type === 'text');
    if (!block || block.type !== 'text') return {};
    try {
      return JSON.parse(block.text) as RawListingDraft;
    } catch {
      return {};
    }
  }
}
