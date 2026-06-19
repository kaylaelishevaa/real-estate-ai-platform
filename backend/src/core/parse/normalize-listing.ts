/**
 * The heart of "validate-don't-trust-the-LLM": take the LOOSE draft the model
 * produced and run every field through deterministic extractors to get a typed,
 * normalized `ParsedListing`. Prices become numbers, phones become canonical
 * keys, types/conditions snap to closed enums, towers split out of names.
 *
 * If the model hallucinated "4.5M" as the price, the number it becomes is
 * decided here — by code we can unit-test — not by the model.
 */

import type { ParsedListing, RawListingDraft, ListingType, Channel } from '../types';
import { parsePrice } from '../extract/price';
import { normalizePhone62, isValidPhone } from '../extract/phone';
import { cleanName } from '../extract/name';
import { resolveProperty } from '../extract/property-types';
import { splitTower, parseUnit } from '../extract/tower';
import {
  normalizeCondition,
  normalizeListingType,
  normalizeChannel,
  normalizePropertyType,
} from '../extract/enums';

function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? parseInt(v.replace(/[^\d]/g, ''), 10) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function normalizeListing(draft: RawListingDraft): ParsedListing {
  const rawName = strOrNull(draft.nama_properti);
  const resolved = resolveProperty(rawName);

  // Property type: prefer an explicit value, fall back to name inference.
  const tipe_properti = normalizePropertyType(draft.tipe_properti) ?? resolved.type;

  // Tower: explicit field wins; otherwise try to split it out of the name.
  const tower_name = strOrNull(draft.tower_name) ?? splitTower(rawName).tower;

  const { unit, unitRaw } = parseUnit(strOrNull(draft.unit));

  // Prices — the high-stakes deterministic step.
  const harga_jual = parsePrice(draft.harga_jual ?? null);
  const harga_sewa = parsePrice(draft.harga_sewa ?? null);
  const harga = parsePrice(draft.harga ?? null) ?? harga_jual ?? harga_sewa;

  // Listing type reconciles the explicit label with which prices exist.
  let tipe_listing: ListingType | null = normalizeListingType(draft.tipe_listing);
  if (harga_jual != null && harga_sewa != null) tipe_listing = 'Jual & Sewa';
  else if (!tipe_listing && harga_jual != null) tipe_listing = 'Jual';
  else if (!tipe_listing && harga_sewa != null) tipe_listing = 'Sewa';

  const owner_name = cleanName(strOrNull(draft.owner_name)) || null;
  const phone62 = normalizePhone62(strOrNull(draft.owner_phone));
  const owner_phone = isValidPhone(phone62) ? phone62 : null;

  // Channel defaults to Direct (the stricter validation path) when unknown, so
  // we fail toward asking for owner details rather than publishing without them.
  const channel: Channel = normalizeChannel(draft.channel) ?? 'Direct';

  return {
    tipe_properti,
    nama_properti: rawName,
    nama_properti_normalized: resolved.canonical || rawName,
    tower_name,
    unit,
    unit_raw: unitRaw,
    tipe_listing,
    channel,
    harga,
    harga_jual,
    harga_sewa,
    kamar_tidur: strOrNull(draft.kamar_tidur),
    kamar_mandi: intOrNull(draft.kamar_mandi),
    luas_bangunan: intOrNull(draft.luas_bangunan),
    luas_tanah: intOrNull(draft.luas_tanah),
    lantai: intOrNull(draft.lantai),
    kondisi: normalizeCondition(draft.kondisi),
    sertifikat: strOrNull(draft.sertifikat),
    owner_name,
    owner_phone,
    notes: strOrNull(draft.notes),
  };
}
