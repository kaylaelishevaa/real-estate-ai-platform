/**
 * A small, general, deterministic extractor used by the FAKE LLM client.
 *
 * This is NOT a fixture lookup — it is rule-based extraction that runs on
 * arbitrary input, which is what makes the offline demo and eval meaningful.
 * Its job is to imitate an LLM well enough to drive the pipeline without a
 * network call, including a realistic *capability gap* between tiers:
 *
 *  - `templateExtract` reads the explicit "Key : Value" broadcast template.
 *    A weak model can do this much.
 *  - `freeformEnrich` mines unstructured prose (prices, phones, bedrooms, a
 *    building name) — the work a stronger model does. Gating this by tier is
 *    how the escalation path becomes observable.
 */

import type { RawListingDraft } from '../types';

const KEY_MAP: Record<string, keyof RawListingDraft> = {
  jalur: 'channel',
  'jalur pemasaran': 'channel',
  'nama properti': 'nama_properti',
  'property name': 'nama_properti',
  unit: 'unit',
  'tipe properti': 'tipe_properti',
  'property type': 'tipe_properti',
  'tipe listing': 'tipe_listing',
  'harga jual': 'harga_jual',
  'harga sewa': 'harga_sewa',
  harga: 'harga',
  'luas bangunan': 'luas_bangunan',
  lb: 'luas_bangunan',
  'luas tanah': 'luas_tanah',
  lt: 'luas_tanah',
  'kamar tidur': 'kamar_tidur',
  'kamar mandi': 'kamar_mandi',
  lantai: 'lantai',
  kondisi: 'kondisi',
  owner: 'owner_name',
  pemilik: 'owner_name',
  'hp owner': 'owner_phone',
  tower: 'tower_name',
  wing: 'tower_name',
  'mata uang': 'currency',
  currency: 'currency',
  catatan: 'notes',
  notes: 'notes',
  keterangan: 'notes',
};

/** Parse explicit "Key : Value" lines. Weak-model capability. */
export function templateExtract(text: string): RawListingDraft {
  const draft: RawListingDraft = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    const field = KEY_MAP[key];
    if (field && draft[field] == null) (draft as Record<string, unknown>)[field] = value;
  }
  return draft;
}

const PRICE_TOKEN = /\b(\d+(?:[.,]\d+)?)\s*(milyar|miliar|juta|jt|m|rb|ribu|k)\b/i;
const PHONE_TOKEN = /(\+?62|0)[\s-]?8\d{2}[\s-]?\d{3,4}[\s-]?\d{3,5}/;

/** Mine unstructured prose to fill gaps. Strong-model capability. */
export function freeformEnrich(text: string, draft: RawListingDraft): RawListingDraft {
  const out: RawListingDraft = { ...draft };
  const lower = text.toLowerCase();

  if (out.harga == null && out.harga_jual == null && out.harga_sewa == null) {
    // A rent price with a period (IDR or USD): "USD 2,300/month", "41jt/bulan".
    const rent =
      /\b(?:rent(?:al)?(?:\s*price)?\s*)?((?:usd|us\$|rp|idr|\$)\s*[\d.,]+(?:\s*(?:jt|juta|miliar|milyar|m|k|rb|ribu))?|[\d.,]+\s*(?:jt|juta|miliar|milyar|m|k|rb|ribu))\s*(?:\/|per\s+)\s*(month|bulan|bln|mo|year|tahun|thn)\b/i.exec(
        text,
      );
    if (rent) {
      out.harga_sewa = `${rent[1].trim()}/${rent[2]}`;
    } else {
      const m = PRICE_TOKEN.exec(text);
      if (m) out.harga = m[0];
    }
  }
  if (out.owner_phone == null) {
    const m = PHONE_TOKEN.exec(text);
    if (m) out.owner_phone = m[0];
  }
  if (out.kamar_tidur == null) {
    // handles "2BR", "2 KT", "2 bedrooms", "studio"
    const m = /\b(studio|\d+)\s*(?:br|kt|bed(?:room)?s?|kamar tidur)\b/i.exec(text);
    if (m) out.kamar_tidur = m[1];
  }
  if (out.kamar_mandi == null) {
    // handles "1KM", "2 bathrooms", "2 baths"
    const m = /\b(\d+)\s*(?:km|bath(?:room)?s?|kamar mandi)\b/i.exec(text);
    if (m) out.kamar_mandi = m[1];
  }
  if (out.luas_bangunan == null) {
    // labeled "LB 76" first, then an unlabeled area like "127 m2" / "127m²"
    const m =
      /\b(?:lb|luas bangunan)\s*:?\s*(\d+)/i.exec(text) ||
      /\b(\d{2,4})\s*(?:m2|m²|sqm|meter)\b/i.exec(text);
    if (m) out.luas_bangunan = m[1];
  }
  if (out.luas_tanah == null) {
    const m = /\b(?:lt|luas tanah)\s*:?\s*(\d+)/i.exec(text);
    if (m) out.luas_tanah = m[1];
  }
  if (out.kondisi == null) {
    const m = /\b(full furnished|fully furnished|semi furnished|unfurnished|furnished|furn|sf|uf)\b/i.exec(text);
    if (m) out.kondisi = m[1];
  }
  if (out.tipe_listing == null) {
    if (/\bdijual\b|\bjual\b/.test(lower) && /\bsewa\b|\bdisewa/.test(lower)) out.tipe_listing = 'Jual & Sewa';
    else if (/\bdisewa|disewakan|\bsewa\b|\brent\b/.test(lower)) out.tipe_listing = 'Sewa';
    else if (/\bdijual|\bjual\b|\bsell\b/.test(lower)) out.tipe_listing = 'Jual';
  }
  if (out.tipe_properti == null) {
    const m = /\b(apartemen|apartment|apt|rumah|house|tanah|ruko|gudang|warehouse|kantor|office|hotel)\b/i.exec(text);
    if (m) out.tipe_properti = m[1];
  }
  if (out.nama_properti == null) {
    const name = guessName(text);
    if (name) out.nama_properti = name;
  }
  if (out.tower_name == null) {
    const m = /\b(?:tower|tw|wing)\s+([A-Za-z0-9]+)\b/i.exec(text);
    if (m) out.tower_name = m[1];
  }
  if (out.unit == null) {
    // "unit 15A", "SS2-20C", or a "(Owner)" note pattern.
    const m = /\bunit\s+([0-9]+[A-Za-z]?)\b/i.exec(text) || /\b([A-Z]{1,4}\d?-\d+[A-Za-z]?)\b/.exec(text);
    if (m) out.unit = m[1];
  }
  if (out.channel == null) {
    if (/\b(cobroke|co-broke|titip jual|titip)\b/i.test(text)) out.channel = 'Cobroke';
    else if (/\b(direct|langsung dari owner|listing direct)\b/i.test(text)) out.channel = 'Direct';
  }
  if (out.owner_name == null) {
    // "owner Pak Budi 0812..." / "pemilik Bu Sari" — capture the name run.
    const m = /\b(?:owner|pemilik)\s+((?:pak|bu|ibu|bapak)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i.exec(text);
    if (m) out.owner_name = m[1].trim();
  }
  if (out.owner_name == null) {
    // Agents often sign off with the contact's name on its own last line
    // (e.g. "...payment in advance.\nAkiyoshi"). Treat a final standalone
    // 1–2 word capitalized line as the owner.
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    if (last && last.length <= 30 && /^[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?$/.test(last)) {
      out.owner_name = last;
    }
  }
  if (out.currency == null && /\b(usd|us\$|dollars?)\b|\$/i.test(text)) out.currency = 'USD';
  if (out.negotiable == null && /\bnego(?:tiable)?\b/i.test(text)) out.negotiable = true;
  if (out.notes == null) {
    // Capture common free-text remarks so the demo surfaces a notes block.
    const m = text.match(
      /\b(balcon(?:y|ies)|city view|sea view|garden view|pool view|mountain view|maid(?:'?s)?\s*(?:room|area)|private (?:lift|elevator)|fully furnished|semi furnished|minimum rental[^.\n]*|full payment in advance|service charge[^.\n]*)\b/gi,
    );
    if (m) out.notes = [...new Set(m.map((s) => s.trim()))].join('; ');
  }
  return out;
}

/**
 * Best-effort building-name guess: the capitalized phrase preceding a building
 * suffix word, or a known-looking shorthand right after a type keyword.
 */
function guessName(text: string): string | null {
  const suffix = /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s+(?:Residence|Suites|View|Hills|Park|Tower|Village|Avenue|Spring)\b/.exec(text);
  if (suffix) return suffix[0].trim();
  const afterType = /\b(?:apartemen|apt|apartment|rumah|ruko|kantor)\s+([A-Za-z][A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/i.exec(text);
  if (afterType) return afterType[1].trim();
  return null;
}
