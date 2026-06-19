import { normalizePhone62, formatPhoneDisplay, phoneDigits, isValidPhone } from './phone';

describe('phone normalization', () => {
  it('collapses every written form to one 62xxx key', () => {
    expect(normalizePhone62('08123456789')).toBe('628123456789');
    expect(normalizePhone62('+62 812 3456 789')).toBe('628123456789');
    expect(normalizePhone62('0812-3456-789')).toBe('628123456789');
    expect(normalizePhone62('628123456789')).toBe('628123456789');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePhone62('')).toBe('');
    expect(normalizePhone62(null)).toBe('');
  });

  it('formats the display and local-digit forms', () => {
    expect(formatPhoneDisplay('08123456789')).toBe('+628123456789');
    expect(phoneDigits('08123456789')).toBe('8123456789');
    expect(formatPhoneDisplay('')).toBe('');
  });

  it('validates plausible Indonesian mobile numbers', () => {
    expect(isValidPhone('08123456789')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});
