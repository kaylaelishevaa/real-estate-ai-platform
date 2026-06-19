import { scoreConfidence } from './confidence';
import { normalizeListing } from './normalize-listing';
import type { RawListingDraft } from '../types';

function score(draft: RawListingDraft) {
  return scoreConfidence(normalizeListing(draft), draft);
}

describe('scoreConfidence', () => {
  it('is high and does not escalate for a complete parse', () => {
    const r = score({
      nama_properti: 'pakview',
      unit: '5A',
      harga_jual: '2M',
      tipe_listing: 'Jual',
      owner_name: 'Budi',
      owner_phone: '08123456789',
    });
    expect(r.score).toBe(1);
    expect(r.shouldEscalate).toBe(false);
  });

  it('is low and escalates when core fields are missing', () => {
    const r = score({});
    expect(r.score).toBeLessThan(0.7);
    expect(r.shouldEscalate).toBe(true);
    expect(r.reasons).toEqual(
      expect.arrayContaining(['property type unresolved', 'property name missing', 'no price']),
    );
  });

  it('flags a price string the deterministic parser rejected', () => {
    const r = score({ nama_properti: 'pakview', harga: 'around four-ish' });
    expect(r.reasons).toContain('price string did not parse');
    expect(r.shouldEscalate).toBe(true);
  });
});
