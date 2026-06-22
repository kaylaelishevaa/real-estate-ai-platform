import { parsePrice, parseMoney, isNegotiable } from './price';

describe('parsePrice — Indonesian property price formats', () => {
  it.each([
    ['4.5M', 4_500_000_000],
    ['4,5 M', 4_500_000_000],
    ['4.5 miliar', 4_500_000_000],
    ['1,2 milyar', 1_200_000_000],
    ['6.3M', 6_300_000_000],
    ['25jt', 25_000_000],
    ['25 juta', 25_000_000],
    ['900jt', 900_000_000],
    ['Rp 900jt', 900_000_000],
    ['@41jt/bulan', 41_000_000],
    ['41 jt /bulan nego', 41_000_000],
    ['1.2m', 1_200_000_000],
  ])('parses %s → %d', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it('treats dotted/spaced numbers without a magnitude word as raw rupiah', () => {
    expect(parsePrice('Rp 1.500.000.000')).toBe(1_500_000_000);
    expect(parsePrice('4.500.000.000')).toBe(4_500_000_000);
  });

  it('passes through a plain number', () => {
    expect(parsePrice(1_500_000_000)).toBe(1_500_000_000);
  });

  it('returns null for ambiguous bare decimals and junk', () => {
    expect(parsePrice('4.5')).toBeNull(); // would mis-read as 45
    expect(parsePrice('900')).toBeNull(); // too small, no magnitude
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('negotiable')).toBeNull();
  });
});

describe('parseMoney — currency + period', () => {
  it('defaults to IDR with no period for a sale price', () => {
    expect(parseMoney('4.5M')).toEqual({ amount: 4_500_000_000, currency: 'IDR', period: null });
  });

  it('reads an IDR rent price per month', () => {
    expect(parseMoney('41jt/bulan')).toEqual({ amount: 41_000_000, currency: 'IDR', period: 'month' });
  });

  it('reads a USD rent price per month', () => {
    expect(parseMoney('USD 2,300/month')).toEqual({ amount: 2300, currency: 'USD', period: 'month' });
  });

  it('reads a USD rent price per year', () => {
    expect(parseMoney('USD 27,600/year')).toEqual({ amount: 27_600, currency: 'USD', period: 'year' });
  });

  it('picks the MONTHLY figure as canonical from a combined quote', () => {
    expect(parseMoney('USD 2,300/month or total USD 27,600/year')).toEqual({
      amount: 2300,
      currency: 'USD',
      period: 'month',
    });
  });

  it('detects negotiable', () => {
    expect(isNegotiable('6.3M nego')).toBe(true);
    expect(isNegotiable('6.3M')).toBe(false);
  });
});
