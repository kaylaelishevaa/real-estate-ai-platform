import { sanityCheck, pricePerSqm } from './sanity-check';
import { normalizeListing } from './normalize-listing';

describe('sanityCheck', () => {
  it('flags nothing for a plausible IDR sale', () => {
    const l = normalizeListing({
      tipe_properti: 'Apartemen',
      nama_properti: 'South Hills',
      harga_jual: '4.5M',
      luas_bangunan: '76',
    });
    expect(sanityCheck(l)).toEqual([]);
  });

  it('catches a 1000x price typo via price-per-m²', () => {
    // "4.5jt" (juta) typed where "4.5M" (miliar) was meant, for a 76 m² apartment
    const l = normalizeListing({
      tipe_properti: 'Apartemen',
      nama_properti: 'South Hills',
      harga_jual: '4.5jt',
      luas_bangunan: '76',
    });
    const codes = sanityCheck(l).map((w) => w.code);
    expect(codes).toContain('price_per_sqm_low');
    expect(codes).toContain('sale_price_low');
  });

  it('skips IDR price bands for a USD listing', () => {
    const l = normalizeListing({
      tipe_properti: 'Apartemen',
      nama_properti: 'La Maison',
      harga_sewa: 'USD 2,300/month',
      currency: 'USD',
      luas_bangunan: '127',
    });
    expect(sanityCheck(l)).toEqual([]);
  });

  it('flags an implausible building area', () => {
    const l = normalizeListing({
      tipe_properti: 'Apartemen',
      nama_properti: 'South Hills',
      harga_jual: '4.5M',
      luas_bangunan: '99999',
    });
    expect(sanityCheck(l).map((w) => w.code)).toContain('luas_bangunan_implausible');
  });

  it('flags an unusually high price-per-m²', () => {
    // 50 miliar over 20 m² = 2.5 billion / m², far above the band
    const l = normalizeListing({
      tipe_properti: 'Apartemen',
      nama_properti: 'South Hills',
      harga_jual: '50M',
      luas_bangunan: '20',
    });
    expect(sanityCheck(l).map((w) => w.code)).toContain('price_per_sqm_high');
  });

  it('flags an unusually high monthly rent', () => {
    const l = normalizeListing({ tipe_properti: 'Apartemen', harga_sewa: '900jt/bulan', luas_bangunan: '80' });
    expect(sanityCheck(l).map((w) => w.code)).toContain('rent_price_high');
  });
});

describe('pricePerSqm divisor rule', () => {
  it('uses building area for vertical types (Apartemen/Kantor)', () => {
    const apt = normalizeListing({ tipe_properti: 'Apartemen', harga_jual: '4M', luas_bangunan: '80', luas_tanah: '200' });
    expect(pricePerSqm(apt)).toBe(50_000_000); // 4e9 / 80
  });

  it('uses land area for land-based types (Rumah, etc.)', () => {
    const rumah = normalizeListing({ tipe_properti: 'Rumah', harga_jual: '4M', luas_bangunan: '80', luas_tanah: '200' });
    expect(pricePerSqm(rumah)).toBe(20_000_000); // 4e9 / 200
  });

  it('returns null when price or area is missing', () => {
    expect(pricePerSqm(normalizeListing({ tipe_properti: 'Apartemen', harga_jual: '4M' }))).toBeNull();
  });
});
