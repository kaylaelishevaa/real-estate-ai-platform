import type { Tier, Currency } from './types';

/** Format an IDR amount, or an em dash for null. */
export function formatIDR(value: number | null | undefined): string {
  if (value == null) return '—';
  return 'Rp ' + value.toLocaleString('id-ID');
}

/** Format a price with its currency and optional rent period. */
export function formatMoney(
  value: number | null | undefined,
  currency: Currency = 'IDR',
  period?: 'month' | 'year' | null,
): string {
  if (value == null) return '—';
  const base =
    currency === 'USD' ? `USD ${value.toLocaleString('en-US')}` : `Rp ${value.toLocaleString('id-ID')}`;
  return period ? `${base} / ${period}` : base;
}

/** Tailwind classes for a draft/active status badge. */
export const STATUS_META: Record<'draft' | 'active', { label: string; classes: string }> = {
  draft: { label: 'draft', classes: 'bg-amber-100 text-amber-800 ring-amber-600/20' },
  active: { label: 'active', classes: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
};

/** Display metadata per model tier — drives the tier badge colors. */
export const TIER_META: Record<Tier, { label: string; classes: string; note: string }> = {
  cheap: {
    label: 'cheap',
    classes: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
    note: 'cheapest model — clean templates',
  },
  mid: {
    label: 'mid',
    classes: 'bg-amber-100 text-amber-800 ring-amber-600/20',
    note: 'escalated — messy free-form',
  },
  strong: {
    label: 'strong',
    classes: 'bg-rose-100 text-rose-800 ring-rose-600/20',
    note: 'strongest model — ambiguous / conflicting',
  },
};

export function humanizeField(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
