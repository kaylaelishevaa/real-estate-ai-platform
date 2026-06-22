/**
 * Property price parsing — currency, amount, and rent period.
 *
 * Most listings are in rupiah ("4.5M" = 4.5 billion, "25jt" = 25 million), but
 * expat rentals are quoted in USD ("USD 2,300/month or total USD 27,600/year").
 * This is deliberately deterministic code, not an LLM job — getting a price wrong
 * by 1000x, or silently dropping a USD rent, is the kind of error that must never
 * depend on model temperature.
 */

import type { Currency, RentPeriod } from '../types';

export interface Money {
  amount: number;
  currency: Currency;
  /** Set when the price is quoted per month/year (rent); null for a sale price. */
  period: RentPeriod | null;
}

const MAGNITUDE: Record<string, number> = {
  k: 1e3,
  ribu: 1e3,
  jt: 1e6,
  juta: 1e6,
  m: 1e9, // in property slang a bare "M" means miliar (billion), not million
  miliar: 1e9,
  milyar: 1e9,
  b: 1e9,
};

// number (with . or , as decimal) optionally followed by a magnitude word
const PRICE_RE = /([\d.,]+)\s*(milyar|miliar|juta|ribu|jt|k|m|b)?\b/i;

function detectCurrency(s: string): Currency {
  return /\b(usd|us\$|dollars?)\b|\$/i.test(s) ? 'USD' : 'IDR';
}

function detectPeriod(s: string): RentPeriod | null {
  if (/\/\s*(month|mo|bulan|bln)\b|\bper\s+(month|bulan|bln)\b|\bmonthly\b/i.test(s)) return 'month';
  if (/\/\s*(year|yr|tahun|thn)\b|\bper\s+(year|tahun|thn)\b|\b(yearly|annual(?:ly)?)\b/i.test(s))
    return 'year';
  return null;
}

/** Parse an IDR amount with magnitude words / thousands separators (the original rule). */
function parseIdrAmount(raw: string): number | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/\b(rp|idr)\b/g, '')
    .replace(/[@]/g, '')
    .replace(/\/\s*(bulan|bln|month|mo|thn|tahun|year|yr)\b/g, '')
    .replace(/\bper\s+(bulan|bln|tahun|thn|month|year)\b/g, '')
    .replace(/\b(nego(?:tiable)?|nett?|all\s*in|total)\b/g, '')
    .trim();

  const m = PRICE_RE.exec(cleaned);
  if (!m) return null;
  const [, numStr, unit] = m;

  if (unit && MAGNITUDE[unit]) {
    const value = parseFloat(numStr.replace(/,/g, '.'));
    return Number.isFinite(value) ? Math.round(value * MAGNITUDE[unit]) : null;
  }

  // No magnitude word: digits only, separators are thousands.
  const digits = numStr.replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = parseInt(digits, 10);
  if (!Number.isFinite(value)) return null;
  // Guard against ambiguous bare decimals like "4.5" (→ "45").
  if (value < 100_000) return null;
  return value;
}

/** Parse a USD amount: "," = thousands, "." = decimal ("USD 2,300" → 2300). */
function parseUsdAmount(raw: string): number | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/\b(usd|us\$|dollars?)\b/g, '')
    .replace(/\$/g, '')
    .replace(/\b(total|exc|excl|tax|nego(?:tiable)?|nett?|all\s*in)\b/g, '')
    .replace(/\/\s*(month|mo|bulan|bln|year|yr|tahun|thn)\b/g, '')
    .replace(/\bper\s+(month|bulan|year|tahun)\b/g, '')
    .trim();

  const m = /([\d][\d,]*(?:\.\d+)?)/.exec(cleaned);
  if (!m) return null;
  const value = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Parse a price expression to { amount, currency, period }, or null.
 * For a combined rent quote ("X/month or total Y/year") the MONTHLY figure is
 * canonical; the yearly clause is recognized but the monthly amount wins.
 */
export function parseMoney(raw: string | number | null | undefined): Money | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? { amount: Math.round(raw), currency: 'IDR', period: null } : null;
  }

  const currency = detectCurrency(raw);
  const parseAmount = currency === 'USD' ? parseUsdAmount : parseIdrAmount;

  // Split on "or"/"atau" so "X/month or Y/year" yields separate clauses.
  const clauses = raw.split(/\b(?:or|atau)\b/i).map((c) => c.trim()).filter(Boolean);
  const parsed: Money[] = [];
  for (const clause of clauses) {
    const amount = parseAmount(clause);
    if (amount != null) parsed.push({ amount, currency, period: detectPeriod(clause) });
  }

  if (parsed.length === 0) {
    const amount = parseAmount(raw);
    return amount == null ? null : { amount, currency, period: detectPeriod(raw) };
  }
  // Prefer the monthly clause as canonical; otherwise the first.
  return parsed.find((p) => p.period === 'month') ?? parsed[0];
}

/** Back-compat: the amount only (currency/period dropped). */
export function parsePrice(raw: string | number | null | undefined): number | null {
  return parseMoney(raw)?.amount ?? null;
}

/** Was a price marked negotiable? ("nego", "negotiable"). */
export function isNegotiable(text: string | null | undefined): boolean {
  return text != null && /\bnego(?:tiable)?\b/i.test(text);
}
