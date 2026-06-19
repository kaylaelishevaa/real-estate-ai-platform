import { ListingIngestPipeline } from './ingest-listing';
import { FakeLlmClient } from '../llm/fake-llm-client';
import type { InboundMessage } from '../types';

const TEMPLATE = [
  'Jalur : Direct',
  'Nama Properti : Pakubuwono View',
  'Unit : 15A',
  'Tipe Properti : Apartemen',
  'Tipe Listing : Jual',
  'Harga Jual : 4.5M',
  'Kamar Tidur : 2',
  'Kamar Mandi : 1',
  'Luas Bangunan : 76',
  'Kondisi : Furnished',
  'Owner : Budi',
  'HP Owner : 08123456789',
].join('\n');

const textMsg = (text: string): InboundMessage => ({ type: 'text', from: '628', text });

describe('ListingIngestPipeline', () => {
  it('parses, validates, and writes a complete listing', async () => {
    const pipe = new ListingIngestPipeline(new FakeLlmClient());
    const r = await pipe.ingest(textMsg(TEMPLATE));

    expect(r.status).toBe('written');
    expect(r.created).toBe(true);
    expect(r.tier).toBe('haiku');
    expect(r.listing?.harga).toBe(4_500_000_000);
    expect(pipe.listings.size()).toBe(1);
  });

  it('rejects non-listing message types (fails closed)', async () => {
    const pipe = new ListingIngestPipeline(new FakeLlmClient());
    const r = await pipe.ingest({ type: 'location', from: '628' } as InboundMessage);
    expect(r.status).toBe('rejected');
    expect(pipe.listings.size()).toBe(0);
  });

  it('asks for more info instead of writing a half listing', async () => {
    const pipe = new ListingIngestPipeline(new FakeLlmClient());
    const r = await pipe.ingest(
      textMsg('Nama Properti : Pakubuwono View\nTipe Properti : Apartemen\nTipe Listing : Jual'),
    );
    expect(r.status).toBe('needs_more_info');
    expect(r.missing).toEqual(expect.arrayContaining(['harga', 'unit', 'owner_name']));
    expect(pipe.listings.size()).toBe(0);
  });

  it('is idempotent across republished broadcasts', async () => {
    const pipe = new ListingIngestPipeline(new FakeLlmClient());
    await pipe.ingest(textMsg(TEMPLATE));
    const second = await pipe.ingest(textMsg(TEMPLATE));

    expect(second.created).toBe(false);
    expect(pipe.listings.size()).toBe(1);
  });

  it('escalates model tier for a messy free-form broadcast', async () => {
    const llm = new FakeLlmClient();
    const pipe = new ListingIngestPipeline(llm);
    const r = await pipe.ingest(
      textMsg(
        'Cobroke dijual apartemen Pakubuwono View tower Redwood unit 15A, ' +
          '2BR 1KM LB 76, 4.5M nego, furnished',
      ),
    );
    expect(llm.calls.map((c) => c.tier)).toContain('sonnet');
    expect(r.tier).toBe('sonnet');
  });
});
