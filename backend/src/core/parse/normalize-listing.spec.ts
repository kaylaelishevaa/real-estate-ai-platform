import { normalizeListing } from './normalize-listing';
import type { RawListingDraft } from '../types';

describe('normalizeListing — loose draft → typed listing', () => {
  it('normalizes a realistic messy draft end to end', () => {
    const draft: RawListingDraft = {
      nama_properti: 'pakview',
      tipe_properti: null, // inferred from the alias
      unit: 'PV 15A',
      tower_name: 'Redwood',
      harga_jual: '4.5M',
      harga_sewa: '41jt/bulan',
      kamar_tidur: '2',
      kamar_mandi: '1',
      luas_bangunan: '76',
      kondisi: 'SF',
      owner_name: 'Pak Budi',
      owner_phone: '0812-3456-789',
      channel: 'Direct',
    };

    const l = normalizeListing(draft);

    expect(l.tipe_properti).toBe('Apartemen'); // inferred from "pakview"
    expect(l.nama_properti_normalized).toBe('Pakubuwono View');
    expect(l.tower_name).toBe('Redwood');
    expect(l.unit).toBe('15A');
    expect(l.unit_raw).toBe('PV 15A');
    expect(l.harga_jual).toBe(4_500_000_000);
    expect(l.harga_sewa).toBe(41_000_000);
    expect(l.harga).toBe(4_500_000_000); // primary = jual
    expect(l.tipe_listing).toBe('Jual & Sewa'); // both prices present
    expect(l.kamar_tidur).toBe('2');
    expect(l.kamar_mandi).toBe(1);
    expect(l.luas_bangunan).toBe(76);
    expect(l.kondisi).toBe('Semi Furnished');
    expect(l.owner_name).toBe('Budi');
    expect(l.owner_phone).toBe('628123456789');
    expect(l.channel).toBe('Direct');
  });

  it('defaults channel to Direct when not stated', () => {
    expect(normalizeListing({ nama_properti: 'x' }).channel).toBe('Direct');
  });

  it('drops an invalid phone rather than storing garbage', () => {
    expect(normalizeListing({ owner_phone: '123' }).owner_phone).toBeNull();
  });

  it('infers listing type from the single price present', () => {
    expect(normalizeListing({ harga_sewa: '30jt' }).tipe_listing).toBe('Sewa');
    expect(normalizeListing({ harga_jual: '2M' }).tipe_listing).toBe('Jual');
  });
});
