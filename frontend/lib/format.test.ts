import { describe, it, expect } from 'vitest';
import { formatIDR, formatMoney, humanizeField, STATUS_META } from './format';

describe('formatIDR', () => {
  it('formats rupiah with thousands separators', () => {
    expect(formatIDR(4_500_000_000)).toBe('Rp 4.500.000.000');
  });
  it('renders an em dash for null', () => {
    expect(formatIDR(null)).toBe('—');
    expect(formatIDR(undefined)).toBe('—');
  });
});

describe('formatMoney', () => {
  it('defaults to IDR', () => {
    expect(formatMoney(6_300_000_000)).toBe('Rp 6.300.000.000');
  });
  it('formats USD with a per-period suffix', () => {
    expect(formatMoney(2300, 'USD', 'month')).toBe('USD 2,300 / month');
    expect(formatMoney(27_600, 'USD', 'year')).toBe('USD 27,600 / year');
  });
  it('omits the period when there is none', () => {
    expect(formatMoney(2300, 'USD')).toBe('USD 2,300');
  });
  it('renders an em dash for null', () => {
    expect(formatMoney(null, 'USD', 'month')).toBe('—');
  });
});

describe('humanizeField', () => {
  it('turns a snake_case key into Title Case', () => {
    expect(humanizeField('owner_phone')).toBe('Owner Phone');
    expect(humanizeField('harga')).toBe('Harga');
  });
});

describe('STATUS_META', () => {
  it('has labels for draft and active', () => {
    expect(STATUS_META.draft.label).toBe('draft');
    expect(STATUS_META.active.label).toBe('active');
  });
});
