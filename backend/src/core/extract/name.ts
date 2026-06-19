/**
 * Owner-name cleaning.
 *
 * Strips Indonesian honorifics ("Bu", "Pak", "Ibu") that agents prepend, but
 * preserves professional titles ("Dr", "Ir", "PT") that are part of the legal
 * name. Normalizes ALL-CAPS / all-lower to Title Case so the CRM is consistent.
 */

const STRIP_HONORIFICS = /\b(ibu|bu|bapak|pak|mr\.?|mrs\.?|ny\.?|tn\.?|owner|agent|agen)\b/gi;
const KEEP_TITLES = /\b(Dr|Ir|SE|SH|MM|MBA|PhD|S\.?Pd|S\.?Kom|S\.?H|S\.?E|PT|CV)\b/gi;

export function cleanName(raw: string | null | undefined): string {
  if (!raw) return '';

  // Protect professional titles behind placeholders so honorific-stripping and
  // case-folding don't mangle them.
  const titles: string[] = [];
  let cleaned = raw.replace(KEEP_TITLES, (match) => {
    titles.push(match);
    return `__TITLE${titles.length - 1}__`;
  });

  cleaned = cleaned.replace(STRIP_HONORIFICS, '').replace(/\s+/g, ' ').trim();

  // Title-case only when the input is uniformly cased (don't touch "McKenzie").
  if (cleaned && (cleaned === cleaned.toUpperCase() || cleaned === cleaned.toLowerCase())) {
    cleaned = cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  cleaned = cleaned.replace(/__TITLE(\d+)__/g, (_, i) => titles[Number(i)]);
  return cleaned.trim();
}
