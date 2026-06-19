import { splitTower, parseUnit, extractOwnerFromParens } from './tower';

describe('splitTower', () => {
  it('separates an explicit tower from the name', () => {
    expect(splitTower('Casa Grande Tower Montana')).toEqual({
      name: 'Casa Grande',
      tower: 'Montana',
    });
    expect(splitTower('Apartment tw Redwood')).toEqual({ name: 'Apartment', tower: 'Redwood' });
  });

  it('leaves names without an explicit tower untouched', () => {
    expect(splitTower('South Hills')).toEqual({ name: 'South Hills', tower: null });
    expect(splitTower('')).toEqual({ name: '', tower: null });
  });
});

describe('parseUnit', () => {
  it('strips the building prefix, keeping unit and raw', () => {
    expect(parseUnit('SS2-20C')).toEqual({ unit: '20C', unitRaw: 'SS2-20C' });
    expect(parseUnit('PV 15A')).toEqual({ unit: '15A', unitRaw: 'PV 15A' });
    expect(parseUnit('20C')).toEqual({ unit: '20C', unitRaw: '20C' });
  });

  it('returns nulls for empty input', () => {
    expect(parseUnit(null)).toEqual({ unit: null, unitRaw: null });
  });
});

describe('extractOwnerFromParens', () => {
  it('pulls an owner name out of a parenthetical', () => {
    expect(extractOwnerFromParens('SS2-20C (Rena)')).toBe('Rena');
  });

  it('ignores non-name parentheticals', () => {
    expect(extractOwnerFromParens('(123)')).toBeNull();
    expect(extractOwnerFromParens('no parens here')).toBeNull();
  });
});
