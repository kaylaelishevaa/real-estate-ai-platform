/**
 * Indonesian property price parsing.
 *
 * Agents write prices a dozen ways: "4.5M", "4,5 miliar", "25jt", "Rp 900jt",
 * "@41jt/bulan negotiable". The magnitude word ("jt"/"juta" = million,
 * "M"/"miliar" = billion) is the load-bearing token. This is deliberately
 * deterministic code, not an LLM job — getting a price wrong by 1000x is the
 * kind of error that must never depend on model temperature.
 */

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

/**
 * Parse a single price token to an integer number of IDR, or null if it cannot
 * be parsed unambiguously.
 *
 * Rules:
 *  - With a magnitude word, the leading number is a decimal value ("4.5M" → 4.5e9).
 *  - Without one, the token is treated as a raw rupiah amount with "." / "," / " "
 *    acting as thousands separators ("Rp 1.500.000.000" → 1_500_000_000).
 *  - A bare number under 100,000 and no magnitude word is ambiguous → null.
 */
export function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;

  // Strip currency noise, periodicity, and negotiation words.
  const cleaned = raw
    .toLowerCase()
    .replace(/\b(rp|idr)\b/g, '')
    .replace(/[@]/g, '')
    .replace(/\/\s*(bulan|bln|month|mo|thn|tahun|year|yr)\b/g, '')
    .replace(/\bper\s+(bulan|bln|tahun|thn)\b/g, '')
    .replace(/\b(nego(tiable)?|nett?|all\s*in)\b/g, '')
    .trim();

  const m = PRICE_RE.exec(cleaned);
  if (!m) return null;

  const [, numStr, unit] = m;

  if (unit && MAGNITUDE[unit]) {
    // Decimal value × magnitude. Here "." and "," are decimal separators.
    const value = parseFloat(numStr.replace(/\./g, '.').replace(/,/g, '.'));
    if (!Number.isFinite(value)) return null;
    return Math.round(value * MAGNITUDE[unit]);
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
