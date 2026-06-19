import { cleanName } from './name';

describe('cleanName', () => {
  it('strips Indonesian honorifics', () => {
    expect(cleanName('Pak Budi')).toBe('Budi');
    expect(cleanName('Ibu Sari')).toBe('Sari');
    expect(cleanName('owner rena')).toBe('Rena');
  });

  it('title-cases ALL-CAPS and all-lower input', () => {
    expect(cleanName('IBU SARI')).toBe('Sari');
    expect(cleanName('budi santoso')).toBe('Budi Santoso');
  });

  it('preserves professional titles', () => {
    expect(cleanName('Dr. Andi')).toContain('Dr');
    expect(cleanName('PT Maju Jaya')).toContain('PT');
  });

  it('returns empty string for empty input', () => {
    expect(cleanName('')).toBe('');
    expect(cleanName(null)).toBe('');
  });
});
