/**
 * Plausibility ("are you sure?") checks on a normalized listing.
 *
 * Field-validation answers "are the required fields PRESENT?". This adds a
 * second, advisory layer: "are the VALUES sane?" A price off by 1000x (an agent
 * typing "4.5jt" when they meant "4.5M"), an implausible area, or an absurd
 * price-per-m² gets flagged as a NON-BLOCKING warning for a human to confirm,
 * instead of being silently published.
 *
 * This mirrors the production WhatsApp flow, which computes a price-per-m² and
 * shows it in the confirmation summary so the agent eyeballs it before the
 * record is written ("Rp 6.3M = 6.3 billion, correct?"). Here it's automated:
 * the warnings ride alongside the parse result; they never block a write.
 */

import type { ParsedListing, PropertyType } from '../types';

export interface SanityWarning {
  /** Machine-readable code, e.g. 'price_per_sqm_low'. */
  code: string;
  /** The field the warning is about. */
  field: string;
  /** Human-facing "please confirm" message (plain language, no jargon). */
  message: string;
}

// Deliberately WIDE, illustrative IDR bands so only genuinely suspicious values
// flag. These are public, generic ranges (not business figures), and tunable.
const SALE_PRICE_IDR = { min: 100_000_000, max: 500_000_000_000 }; // 100 jt .. 500 miliar
const RENT_PRICE_IDR = { min: 500_000, max: 500_000_000 }; // 500 rb .. 500 jt / month
const AREA_M2 = { min: 5, max: 5_000 };
const PRICE_PER_SQM_IDR = { min: 2_000_000, max: 200_000_000 }; // 2 jt .. 200 jt / m²

/** Vertical types price against building area; everything else against land. */
const VERTICAL: PropertyType[] = ['Apartemen', 'Kantor'];

function idr(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

/** The single sale-side price (or null for a rent-only listing). */
function salePrice(l: ParsedListing): number | null {
  const p = l.harga_jual ?? (l.rent_period ? null : l.harga);
  return p != null && p > 0 ? p : null;
}

/** Price per m², matching the production divisor rule. Null if not computable. */
export function pricePerSqm(l: ParsedListing): number | null {
  const price = salePrice(l);
  if (price == null) return null;
  const area = l.tipe_properti && VERTICAL.includes(l.tipe_properti)
    ? l.luas_bangunan
    : (l.luas_tanah ?? l.luas_bangunan);
  if (area == null || area <= 0) return null;
  return Math.round(price / area);
}

/** Return advisory plausibility warnings. Empty array = nothing looks off. */
export function sanityCheck(l: ParsedListing): SanityWarning[] {
  const warnings: SanityWarning[] = [];

  // Price magnitude only makes sense in rupiah: USD has a different scale and
  // no jt/M ambiguity, so the IDR bands would false-flag it.
  if (l.currency === 'IDR') {
    const sale = salePrice(l);
    if (sale != null) {
      if (sale < SALE_PRICE_IDR.min) {
        warnings.push({
          code: 'sale_price_low',
          field: 'harga_jual',
          message: `Sale price ${idr(sale)} looks very low. Please double-check the magnitude (juta vs miliar).`,
        });
      } else if (sale > SALE_PRICE_IDR.max) {
        warnings.push({
          code: 'sale_price_high',
          field: 'harga_jual',
          message: `Sale price ${idr(sale)} looks unusually high. Please confirm.`,
        });
      }
    }

    if (l.harga_sewa != null && l.harga_sewa > 0 && l.rent_period !== 'year') {
      if (l.harga_sewa < RENT_PRICE_IDR.min) {
        warnings.push({
          code: 'rent_price_low',
          field: 'harga_sewa',
          message: `Rent price ${idr(l.harga_sewa)} looks very low. Please confirm the period and magnitude.`,
        });
      } else if (l.harga_sewa > RENT_PRICE_IDR.max) {
        warnings.push({
          code: 'rent_price_high',
          field: 'harga_sewa',
          message: `Rent price ${idr(l.harga_sewa)} per month looks unusually high. Please confirm.`,
        });
      }
    }

    // The strongest 1000x-typo catch: price-per-m² out of a sane band.
    const pps = pricePerSqm(l);
    if (pps != null) {
      if (pps < PRICE_PER_SQM_IDR.min) {
        warnings.push({
          code: 'price_per_sqm_low',
          field: 'harga',
          message: `That is about ${idr(pps)} per m², which is unusually low. A 1000x price typo (juta vs miliar) is the usual cause. Please confirm.`,
        });
      } else if (pps > PRICE_PER_SQM_IDR.max) {
        warnings.push({
          code: 'price_per_sqm_high',
          field: 'harga',
          message: `That is about ${idr(pps)} per m², which is unusually high. Please confirm the price and area.`,
        });
      }
    }
  }

  // Area plausibility (currency-independent).
  const areas: Array<['luas_bangunan' | 'luas_tanah', string]> = [
    ['luas_bangunan', 'Building area'],
    ['luas_tanah', 'Land area'],
  ];
  for (const [field, label] of areas) {
    const v = l[field];
    if (v != null && v > 0 && (v < AREA_M2.min || v > AREA_M2.max)) {
      warnings.push({
        code: `${field}_implausible`,
        field,
        message: `${label} of ${v} m² looks out of range. Please confirm.`,
      });
    }
  }

  if (l.kamar_mandi != null && l.kamar_mandi > 20) {
    warnings.push({
      code: 'kamar_mandi_high',
      field: 'kamar_mandi',
      message: `${l.kamar_mandi} bathrooms looks unusually high. Please confirm.`,
    });
  }

  return warnings;
}
