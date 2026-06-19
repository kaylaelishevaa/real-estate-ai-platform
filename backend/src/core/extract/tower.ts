/**
 * Tower / unit / owner extraction from the shorthand agents use.
 *
 * A line like "note : SS2-20C (Rena)" packs three facts: tower/building code,
 * unit number, and owner name. Pulling these apart deterministically keeps the
 * unit key clean for dedup (the unit is the idempotency key for a listing).
 */

/**
 * Separate an explicit tower/wing from a property name.
 * "Casa Grande Tower Montana" → { name: "Casa Grande", tower: "Montana" }
 * Conservative: only splits on explicit "tower"/"tw"/"wing" keywords.
 */
export function splitTower(rawName: string | null | undefined): {
  name: string;
  tower: string | null;
} {
  const name = (rawName ?? '').trim();
  if (!name) return { name: '', tower: null };

  const m = /\b(?:tower|tw|wing)\s+([A-Za-z0-9]+)\b/i.exec(name);
  if (!m) return { name, tower: null };

  const tower = m[1];
  const stripped = name.replace(m[0], '').replace(/\s+/g, ' ').trim();
  return { name: stripped || name, tower };
}

/**
 * Parse a unit token to { unit, unitRaw }.
 * "SS2-20C" → { unit: "20C", unitRaw: "SS2-20C" }
 * "PV 15A"  → { unit: "15A", unitRaw: "PV 15A" }
 * "20C"     → { unit: "20C", unitRaw: "20C" }
 * The unit is the trailing floor+letter token; the raw keeps the building prefix.
 */
export function parseUnit(raw: string | null | undefined): {
  unit: string | null;
  unitRaw: string | null;
} {
  const s = (raw ?? '').trim();
  if (!s) return { unit: null, unitRaw: null };

  // Trailing unit number: digits then optional letter(s), e.g. 20C, 15, 7AB.
  const m = /(\d+\s*[A-Za-z]{0,2})\s*$/.exec(s);
  const unit = m ? m[1].replace(/\s+/g, '').toUpperCase() : s.toUpperCase();
  return { unit, unitRaw: s };
}

/**
 * Extract an owner name wrapped in parentheses, e.g. "SS2-20C (Rena)" → "Rena".
 * Returns null when there is no parenthetical.
 */
export function extractOwnerFromParens(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /\(([^)]+)\)/.exec(text);
  if (!m) return null;
  const inner = m[1].trim();
  // Ignore parentheticals that are obviously not names (numbers, units).
  if (!inner || /^\d/.test(inner) || inner.length > 40) return null;
  return inner;
}
