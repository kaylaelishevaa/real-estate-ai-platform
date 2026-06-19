import {
  normalizeCondition,
  normalizeListingType,
  normalizeChannel,
  bedroomEnum,
  floorZone,
  normalizePropertyType,
} from './enums';
import { resolveProperty } from './property-types';

describe('enum normalization', () => {
  it('snaps condition variants to the closed set', () => {
    expect(normalizeCondition('SF')).toBe('Semi Furnished');
    expect(normalizeCondition('semi')).toBe('Semi Furnished');
    expect(normalizeCondition('full furnished')).toBe('Furnished');
    expect(normalizeCondition('unfurnished')).toBe('Unfurnished');
    expect(normalizeCondition('???')).toBeNull();
  });

  it('reads listing type, combining jual + sewa', () => {
    expect(normalizeListingType('dijual')).toBe('Jual');
    expect(normalizeListingType('disewakan')).toBe('Sewa');
    expect(normalizeListingType('jual / sewa')).toBe('Jual & Sewa');
    expect(normalizeListingType('apartemen bagus')).toBeNull();
  });

  it('reads channel', () => {
    expect(normalizeChannel('cobroke')).toBe('Cobroke');
    expect(normalizeChannel('titip jual')).toBe('Cobroke');
    expect(normalizeChannel('direct')).toBe('Direct');
    expect(normalizeChannel('')).toBeNull();
  });

  it('maps bedrooms to website buckets', () => {
    expect(bedroomEnum('studio')).toBe('STUDIO');
    expect(bedroomEnum('2')).toBe('TWO_BEDROOMS');
    expect(bedroomEnum('2 + 1')).toBe('TWO_BEDROOMS');
    expect(bedroomEnum('9')).toBeNull();
  });

  it('buckets floors into zones', () => {
    expect(floorZone(5)).toBe('low');
    expect(floorZone(15)).toBe('mid');
    expect(floorZone(25)).toBe('high');
    expect(floorZone(0)).toBeNull();
  });

  it('coerces property type to the closed set', () => {
    expect(normalizePropertyType('apt')).toBe('Apartemen');
    expect(normalizePropertyType('Rumah')).toBe('Rumah');
    expect(normalizePropertyType('spaceship')).toBeNull();
  });
});

describe('resolveProperty (alias table)', () => {
  it('expands known shorthand and infers type', () => {
    expect(resolveProperty('pakview')).toEqual({
      canonical: 'Pakubuwono View',
      type: 'Apartemen',
      aliasHit: true,
    });
    expect(resolveProperty('pakview redwood').canonical).toBe('Pakubuwono View');
  });

  it('keyword-guesses type for unknown names without claiming an alias hit', () => {
    const r = resolveProperty('Sudirman Office');
    expect(r.type).toBe('Kantor');
    expect(r.aliasHit).toBe(false);
  });

  it('returns nulls for an empty name', () => {
    expect(resolveProperty('')).toEqual({ canonical: '', type: null, aliasHit: false });
  });
});
