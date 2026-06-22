/**
 * The heart of "validate-don't-trust-the-LLM": take the LOOSE draft the model
 * produced and run every field through deterministic extractors to get a typed,
 * normalized `ParsedListing`. Prices become numbers, phones become canonical
 * keys, types/conditions snap to closed enums, towers split out of names.
 *
 * If the model hallucinated "4.5M" as the price, the number it becomes is
 * decided here — by code we can unit-test — not by the model.
 */

import type { ParsedListing, RawListingDraft, ListingType, Channel, Currency } from '../types';
import { parseMoney, isNegotiable } from '../extract/price';
import { normalizePhone62, isValidPhone } from '../extract/phone';
import { cleanName } from '../extract/name';
import { resolveProperty } from '../extract/property-types';
import { splitTower, parseUnit } from '../extract/tower';
import {
  normalizeCondition,
  normalizeListingType,
  normalizeChannel,
  normalizePropertyType,
  normalizeCurrency,
} from '../extract/enums';

function negotiableFrom(draft: RawListingDraft): boolean {
  if (draft.negotiable === true) return true;
  if (typeof draft.negotiable === 'string' && /\b(true|yes|nego(?:tiable)?)\b/i.test(draft.negotiable))
    return true;
  return [draft.harga, draft.harga_jual, draft.harga_sewa, draft.notes].some(
    (v) => typeof v === 'string' && isNegotiable(v),
  );
}

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

  // Prices — the high-stakes deterministic step (currency + period aware).
  const moneyJual = parseMoney(draft.harga_jual ?? null);
  const moneySewa = parseMoney(draft.harga_sewa ?? null);
  const moneyHarga = parseMoney(draft.harga ?? null);

  const harga_jual = moneyJual?.amount ?? null;
  const harga_sewa = moneySewa?.amount ?? null;
  const harga = moneyHarga?.amount ?? harga_jual ?? harga_sewa;

  // Currency: an explicit hint wins, else the currency of whichever price exists.
  const currency: Currency =
    normalizeCurrency(draft.currency) ??
    moneySewa?.currency ??
    moneyJual?.currency ??
    moneyHarga?.currency ??
    'IDR';
  // Rent period comes from the rent price (or a harga that's quoted per period).
  const rent_period = moneySewa?.period ?? moneyHarga?.period ?? null;

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
    currency,
    rent_period,
    negotiable: negotiableFrom(draft),
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
