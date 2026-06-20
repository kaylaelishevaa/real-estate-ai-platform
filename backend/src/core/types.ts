/**
 * Core domain types for the listing parser.
 *
 * Two shapes matter here:
 *  - `RawListingDraft` — the LOOSE output we accept from the LLM. Every field is
 *    optional and price/area fields arrive as free-form strings ("4.5M", "25jt").
 *    We never trust this directly.
 *  - `ParsedListing` — the NORMALIZED, typed result after deterministic extractors
 *    have cleaned and validated the draft. This is what we persist.
 *
 * Keeping these distinct is the whole "validate-don't-trust-the-LLM" thesis: the
 * model proposes, deterministic code disposes.
 */

export type PropertyType =
  | 'Apartemen'
  | 'Rumah'
  | 'Tanah'
  | 'Ruko'
  | 'Gudang'
  | 'Kantor'
  | 'Hotel'
  | 'Ruang Usaha'
  | 'Gedung';

export type ListingType = 'Jual' | 'Sewa' | 'Jual & Sewa';

export type Channel = 'Direct' | 'Cobroke';

export type Condition = 'Furnished' | 'Semi Furnished' | 'Unfurnished';

/**
 * Model tiers, cheapest → strongest. Index order is the escalation order.
 * Provider-neutral on purpose: the concrete model behind each tier is decided
 * by the LLM adapter, not the pipeline.
 */
export const MODEL_TIERS = ['cheap', 'mid', 'strong'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/**
 * Loose, untrusted extraction from the LLM. Strings are intentionally raw —
 * normalization happens in deterministic code, not in the prompt.
 */
export interface RawListingDraft {
  tipe_properti?: string | null;
  nama_properti?: string | null;
  unit?: string | null;
  tipe_listing?: string | null;
  channel?: string | null; // raw "Jalur" value: Direct / Cobroke
  harga?: string | number | null; // "4.5M", "25jt", or a number
  harga_jual?: string | number | null;
  harga_sewa?: string | number | null;
  kamar_tidur?: string | null;
  kamar_mandi?: string | number | null;
  luas_bangunan?: string | number | null;
  luas_tanah?: string | number | null;
  lantai?: string | number | null;
  kondisi?: string | null;
  sertifikat?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  tower_name?: string | null;
  notes?: string | null;
}

/** Normalized, typed listing. The output of the deterministic pipeline. */
export interface ParsedListing {
  tipe_properti: PropertyType | null;
  nama_properti: string | null;
  nama_properti_normalized: string | null;
  tower_name: string | null;
  unit: string | null;
  unit_raw: string | null;
  tipe_listing: ListingType | null;
  channel: Channel;
  harga: number | null;
  harga_jual: number | null;
  harga_sewa: number | null;
  kamar_tidur: string | null;
  kamar_mandi: number | null;
  luas_bangunan: number | null;
  luas_tanah: number | null;
  lantai: number | null;
  kondisi: Condition | null;
  sertifikat: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  notes: string | null;
}

/** A single inbound WhatsApp message as it arrives from the webhook. */
export interface InboundMessage {
  type: string; // 'text' | 'image' | anything Meta sends — we whitelist this
  from: string;
  text?: string;
  mediaId?: string;
  timestamp?: string;
}
