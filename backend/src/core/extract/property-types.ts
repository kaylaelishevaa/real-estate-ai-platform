/**
 * Property-name aliases and type inference.
 *
 * Agents type shorthand ("pakview", "CG", "SS2"). Rather than ask the LLM to be
 * the source of truth for an evolving building registry, we keep a deterministic
 * alias table. The LLM extracts the raw name; this code resolves it. New buildings
 * are a one-line data edit + a test, not a prompt change.
 *
 * All names below are fabricated/illustrative for this public sample.
 */

import type { PropertyType } from '../types';

interface AliasEntry {
  canonical: string;
  type: PropertyType;
}

/** Shorthand → canonical name + inferred property type. Lowercased keys. */
const ALIASES: Record<string, AliasEntry> = {
  pakview: { canonical: 'Pakubuwono View', type: 'Apartemen' },
  pakvu: { canonical: 'Pakubuwono View', type: 'Apartemen' },
  'paku view': { canonical: 'Pakubuwono View', type: 'Apartemen' },
  pv: { canonical: 'Pakubuwono View', type: 'Apartemen' },
  pakres: { canonical: 'Pakubuwono Residence', type: 'Apartemen' },
  pakspring: { canonical: 'Pakubuwono Spring', type: 'Apartemen' },
  casagrande: { canonical: 'Casa Grande', type: 'Apartemen' },
  'casa grande': { canonical: 'Casa Grande', type: 'Apartemen' },
  cg: { canonical: 'Casa Grande', type: 'Apartemen' },
  sudsuites: { canonical: 'Sudirman Suites', type: 'Apartemen' },
  '1park': { canonical: '1Park Avenue', type: 'Apartemen' },
  '1 park': { canonical: '1Park Avenue', type: 'Apartemen' },
  southhills: { canonical: 'South Hills', type: 'Apartemen' },
  'south hills': { canonical: 'South Hills', type: 'Apartemen' },
  ss2: { canonical: 'Senopati Suites 2', type: 'Apartemen' },
  anandamaya: { canonical: 'Anandamaya Residence', type: 'Apartemen' },
  '18officepark': { canonical: '18 Office Park', type: 'Kantor' },
  '18 office park': { canonical: '18 Office Park', type: 'Kantor' },
};

/**
 * Keyword → type fallback for names not in the alias table. Order matters:
 * the first matching keyword wins.
 */
const TYPE_KEYWORDS: Array<[RegExp, PropertyType]> = [
  [/\b(residence|suites|apartment|apartemen|tower)\b/i, 'Apartemen'],
  [/\b(office|kantor|menara)\b/i, 'Kantor'],
  [/\b(ruko|shophouse)\b/i, 'Ruko'],
  [/\b(gudang|warehouse)\b/i, 'Gudang'],
  [/\b(hotel)\b/i, 'Hotel'],
  [/\b(house|villa|townhouse|rumah)\b/i, 'Rumah'],
];

export interface ResolvedProperty {
  /** Best-effort canonical name (alias-expanded when known). */
  canonical: string;
  /** Inferred property type, or null when genuinely unknown. */
  type: PropertyType | null;
  /** True when the name matched a known alias (high confidence). */
  aliasHit: boolean;
}

/**
 * Resolve a raw property name to a canonical name + inferred type.
 * Returns `aliasHit: false` and a best-effort keyword guess when the name is
 * not in the alias table — the caller can treat that as lower confidence.
 */
export function resolveProperty(rawName: string | null | undefined): ResolvedProperty {
  const name = (rawName ?? '').trim();
  if (!name) return { canonical: '', type: null, aliasHit: false };

  const lower = name.toLowerCase();

  // Exact alias hit.
  if (ALIASES[lower]) {
    return { canonical: ALIASES[lower].canonical, type: ALIASES[lower].type, aliasHit: true };
  }

  // Prefix alias hit (e.g. "pakview redwood" → Pakubuwono View).
  for (const key of Object.keys(ALIASES)) {
    if (lower.startsWith(key + ' ')) {
      return { canonical: ALIASES[key].canonical, type: ALIASES[key].type, aliasHit: true };
    }
  }

  // Keyword fallback — keep the raw name, guess the type.
  for (const [re, type] of TYPE_KEYWORDS) {
    if (re.test(name)) return { canonical: name, type, aliasHit: false };
  }

  return { canonical: name, type: null, aliasHit: false };
}
