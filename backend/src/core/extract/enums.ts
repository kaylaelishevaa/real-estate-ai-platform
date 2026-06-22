/**
 * Enum normalization for the loose values agents type.
 *
 * "SF" / "semi furnish" / "Semi-Furnished" all mean the same thing; the website
 * and CRM only accept one canonical spelling. These map free text → the closed
 * set, returning null when there is no confident match (so validation can ask).
 */

import type { Condition, ListingType, Channel, PropertyType, Currency } from '../types';

export function normalizeCurrency(raw: string | null | undefined): Currency | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (/usd|us\$|\$|dollar/.test(s)) return 'USD';
  if (/idr|rp|rupiah/.test(s)) return 'IDR';
  return null;
}

export function normalizeCondition(raw: string | null | undefined): Condition | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  if (/^(unfurnished|unfurnish|uf|kosong|non furnished)/.test(s)) return 'Unfurnished';
  if (/^(semi furnished|semi furnish|semi|sf)/.test(s)) return 'Semi Furnished';
  if (/^(furnished|furnish|full furnished|fully furnished|furn|ff)/.test(s)) return 'Furnished';
  return null;
}

export function normalizeListingType(raw: string | null | undefined): ListingType | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  const sell = /\b(jual|dijual|sell|sale)\b/.test(s);
  const rent = /\b(sewa|disewa|disewakan|rent|lease)\b/.test(s);
  if (sell && rent) return 'Jual & Sewa';
  if (rent) return 'Sewa';
  if (sell) return 'Jual';
  return null;
}

export function normalizeChannel(raw: string | null | undefined): Channel | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/\b(cobroke|co-broke|co broke|titip|titip jual)\b/.test(s)) return 'Cobroke';
  if (/\b(direct|langsung|owner|listing direct)\b/.test(s)) return 'Direct';
  return null;
}

/** Canonical bedroom buckets the website filters on. */
const BEDROOM_ENUM: Record<string, string> = {
  studio: 'STUDIO',
  '0': 'STUDIO',
  '1': 'ONE_BEDROOM',
  '2': 'TWO_BEDROOMS',
  '2 + 1': 'TWO_BEDROOMS',
  '3': 'THREE_BEDROOMS',
  '3 + 1': 'THREE_BEDROOMS',
  '4': 'FOUR_BEDROOMS',
  '4 + 1': 'FOUR_BEDROOMS',
  '5': 'FIVE_BEDROOMS',
};

export function bedroomEnum(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return BEDROOM_ENUM[key] ?? null;
}

/** Floor → low/mid/high zone (privacy: exact floors aren't published). */
export function floorZone(floor: number | null | undefined): 'low' | 'mid' | 'high' | null {
  if (!floor || floor <= 0) return null;
  if (floor <= 10) return 'low';
  if (floor <= 20) return 'mid';
  return 'high';
}

const PROPERTY_TYPES: PropertyType[] = [
  'Apartemen',
  'Rumah',
  'Tanah',
  'Ruko',
  'Gudang',
  'Kantor',
  'Hotel',
  'Ruang Usaha',
  'Gedung',
];

/** Coerce a raw type string to the closed PropertyType set, else null. */
export function normalizePropertyType(raw: string | null | undefined): PropertyType | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  for (const t of PROPERTY_TYPES) {
    if (t.toLowerCase() === s) return t;
  }
  if (/(apartment|apartemen|apt)/.test(s)) return 'Apartemen';
  if (/(house|rumah|villa)/.test(s)) return 'Rumah';
  if (/(land|tanah|kavling)/.test(s)) return 'Tanah';
  if (/(shop|ruko)/.test(s)) return 'Ruko';
  if (/(warehouse|gudang)/.test(s)) return 'Gudang';
  if (/(office|kantor)/.test(s)) return 'Kantor';
  if (/(hotel)/.test(s)) return 'Hotel';
  return null;
}
