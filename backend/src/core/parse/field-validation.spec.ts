import { validateListing } from './field-validation';
import { normalizeListing } from './normalize-listing';
import type { ParsedListing } from '../types';

function listing(over: Partial<ParsedListing> = {}): ParsedListing {
  return {
    tipe_properti: 'Apartemen',
    nama_properti: 'Pakubuwono View',
    nama_properti_normalized: 'Pakubuwono View',
    tower_name: null,
    unit: '15A',
    unit_raw: '15A',
    tipe_listing: 'Jual',
    channel: 'Direct',
    harga: 4_500_000_000,
    harga_jual: 4_500_000_000,
    harga_sewa: null,
    kamar_tidur: '2',
    kamar_mandi: 1,
    luas_bangunan: 76,
    luas_tanah: null,
    lantai: null,
    kondisi: 'Furnished',
    sertifikat: null,
    owner_name: 'Budi',
    owner_phone: '628123456789',
    notes: null,
    ...over,
  };
}

describe('validateListing', () => {
  it('passes a complete Direct apartment listing', () => {
    expect(validateListing(listing())).toEqual([]);
  });

  it('requires owner + unit for Direct listings', () => {
    const missing = validateListing(listing({ owner_name: null, owner_phone: null, unit: null }));
    expect(missing).toEqual(expect.arrayContaining(['unit', 'owner_name', 'owner_phone']));
  });

  it('does NOT require owner for Cobroke listings', () => {
    const missing = validateListing(
      listing({ channel: 'Cobroke', owner_name: null, owner_phone: null, unit: null }),
    );
    expect(missing).not.toContain('owner_name');
    expect(missing).not.toContain('unit');
  });

  it('enforces per-type required fields (a house needs land area)', () => {
    const missing = validateListing(
      listing({ tipe_properti: 'Rumah', luas_tanah: null }),
    );
    expect(missing).toContain('luas_tanah');
  });

  it('flags a price-less listing', () => {
    const missing = validateListing(
      normalizeListing({ nama_properti: 'pakview', unit: '5A', channel: 'Cobroke' }),
    );
    expect(missing).toContain('harga');
  });
});
