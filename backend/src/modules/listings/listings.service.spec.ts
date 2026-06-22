import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ListingsService } from './listings.service';

/** No OPENAI_API_KEY → the service uses the deterministic FakeLlmClient. */
function makeService(): ListingsService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new ListingsService(config);
}

const COMPLETE_DIRECT = [
  'Jalur : Direct',
  'Nama Properti : South Hills',
  'Unit : 5A',
  'Tipe Properti : Apartemen',
  'Tipe Listing : Jual',
  'Harga Jual : 4M',
  'Kamar Tidur : 2',
  'Kamar Mandi : 1',
  'Luas Bangunan : 60',
  'Kondisi : Furnished',
  'Owner : Budi',
  'HP Owner : 08123456789',
].join('\n');

describe('ListingsService (edit + delete)', () => {
  let service: ListingsService;

  beforeEach(async () => {
    service = makeService();
    await service.onModuleInit(); // seeds the fabricated listings
  });

  it('seeds fabricated listings on boot', () => {
    expect(service.findAll().length).toBeGreaterThanOrEqual(4);
  });

  it('parse() runs the pipeline and writes a complete listing', async () => {
    const r = await service.parse(COMPLETE_DIRECT);
    expect(r.status).toBe('written');
    expect(r.listing?.nama_properti_normalized).toBe('South Hills');
  });

  describe('PATCH update', () => {
    it('updates editable fields and bumps the revision', () => {
      const id = service.findAll()[0].id;
      const before = service.findOne(id);

      const updated = service.update(id, { kondisi: 'Unfurnished', harga_jual: 6_000_000_000 });

      expect(updated.listing.kondisi).toBe('Unfurnished');
      expect(updated.harga).toBe(6_000_000_000); // primary price stays in sync
      expect(updated.listing.harga_jual).toBe(6_000_000_000);
      expect(updated.revision).toBe(before.revision + 1);
      // persisted
      expect(service.findOne(id).listing.kondisi).toBe('Unfurnished');
    });

    it('normalizes corrected values like the parser (phone, name)', () => {
      const id = service.findAll()[0].id;
      const updated = service.update(id, { owner_name: 'pak DEWA', owner_phone: '0812-3456-789' });
      expect(updated.listing.owner_name).toBe('Dewa');
      expect(updated.listing.owner_phone).toBe('628123456789');
    });

    it('an edit that leaves a half-listing saves it as a draft (with the missing list)', () => {
      const id = service.findAll()[0].id; // a complete (active) Direct listing
      const before = service.findOne(id);
      expect(before.status).toBe('active');

      const updated = service.update(id, { owner_phone: '123' }); // invalid phone → dropped

      expect(updated.status).toBe('draft');
      expect(updated.missing).toContain('owner_phone');
    });

    it('completing a draft via edit flips it to active (no duplicate)', async () => {
      // Parse a Cobroke listing missing only its price → saved as a draft.
      await service.parse(
        [
          'Jalur : Cobroke',
          'Nama Properti : Maple Court',
          'Tipe Properti : Apartemen',
          'Tipe Listing : Jual',
          'Kamar Tidur : 2',
          'Kamar Mandi : 1',
          'Luas Bangunan : 60',
        ].join('\n'),
      );
      const draft = service.findAll().find((l) => l.nama_properti === 'Maple Court');
      expect(draft?.status).toBe('draft');
      expect(draft?.missing).toContain('harga');
      const sizeBefore = service.findAll().length;

      const completed = service.update(draft!.id, { harga_jual: 4_000_000_000 });

      expect(completed.status).toBe('active');
      expect(completed.missing).toEqual([]);
      expect(service.findAll().length).toBe(sizeBefore); // no duplicate
    });

    it('404s for an unknown id', () => {
      expect(() => service.update('does-not-exist', { kondisi: 'Furnished' })).toThrow(
        NotFoundException,
      );
    });
  });

  describe('DELETE remove', () => {
    it('removes the listing, then findOne 404s', () => {
      const id = service.findAll()[0].id;
      const sizeBefore = service.findAll().length;

      service.remove(id);

      expect(service.findAll().length).toBe(sizeBefore - 1);
      expect(() => service.findOne(id)).toThrow(NotFoundException);
    });

    it('404s for an unknown id', () => {
      expect(() => service.remove('does-not-exist')).toThrow(NotFoundException);
    });
  });
});
