/**
 * Indonesian phone normalization.
 *
 * The same owner can appear as "0812-3456-789", "+62 812 3456 789", or
 * "62812345 6789". Dedup and contact-matching only work if every form collapses
 * to one canonical key. `62xxx` is the comparison key; `+62xxx` is the display
 * form for the CRM.
 */

/** Normalize to `62xxx` (no +, no leading 0, no separators). Returns '' if empty. */
export function normalizePhone62(raw: string | null | undefined): string {
  if (!raw) return '';
  let phone = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!phone) return '';
  if (phone.startsWith('0')) phone = '62' + phone.slice(1);
  if (!phone.startsWith('62')) phone = '62' + phone;
  return phone;
}

/** Display form for the CRM: `+62xxx`. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const n = normalizePhone62(raw);
  return n ? '+' + n : '';
}

/** Local digits only (no country code) — used for fuzzy comparison. */
export function phoneDigits(raw: string | null | undefined): string {
  return normalizePhone62(raw).replace(/^62/, '');
}

/** A plausibly-real Indonesian mobile number is 62 + 9–13 digits. */
export function isValidPhone(raw: string | null | undefined): boolean {
  const n = normalizePhone62(raw);
  return /^62\d{8,13}$/.test(n);
}
