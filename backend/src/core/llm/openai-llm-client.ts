import OpenAI from 'openai';
import type { RawListingDraft, ModelTier } from '../types';
import type { ListingLlmClient } from './llm-client';

/**
 * Real OpenAI-backed extractor. OPTIONAL — the demo, eval, and tests all run on
 * FakeLlmClient with zero network. This adapter exists so the same pipeline can
 * run against live models by setting OPENAI_API_KEY.
 *
 * The pipeline depends only on the `ListingLlmClient` interface, so swapping
 * providers is this one file. The escalation tiers (cheap → mid → strong) map to
 * concrete models here; adjust to whatever your account has available.
 *
 * The model is only asked for a LOOSE draft (JSON). All normalization,
 * validation, and price math live in deterministic code — the model is never
 * trusted with a final answer.
 */
const TIER_MODEL: Record<ModelTier, string> = {
  cheap: 'gpt-4o-mini',
  mid: 'gpt-4o',
  strong: 'gpt-4.1',
};

const SYSTEM_PROMPT =
  'You extract real-estate listing fields from free-form bilingual ' +
  '(Indonesian/English) WhatsApp messages sent by property agents. ' +
  'Return ONLY a JSON object with the raw fields you can find. Do not normalize ' +
  'prices or phone numbers — return them as written, INCLUDING the currency and ' +
  'any "/month" or "/year" period (e.g. "USD 2,300/month"). Set "currency" to ' +
  '"USD" or "IDR". Set "negotiable" to true if the price says nego/negotiable. ' +
  'Put free-text remarks (view, facilities, terms) in "notes". Use null for ' +
  'anything not present. Channel ("Jalur") is Direct or Cobroke. Keys: ' +
  'tipe_properti, nama_properti, unit, tipe_listing, channel, currency, harga, ' +
  'harga_jual, harga_sewa, negotiable, kamar_tidur, kamar_mandi, luas_bangunan, ' +
  'luas_tanah, lantai, kondisi, sertifikat, owner_name, owner_phone, tower_name, notes.';

export class OpenAiLlmClient implements ListingLlmClient {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async extract(text: string, tier: ModelTier): Promise<RawListingDraft> {
    const response = await this.client.chat.completions.create({
      model: TIER_MODEL[tier],
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return {};
    try {
      return JSON.parse(content) as RawListingDraft;
    } catch {
      return {};
    }
  }
}
