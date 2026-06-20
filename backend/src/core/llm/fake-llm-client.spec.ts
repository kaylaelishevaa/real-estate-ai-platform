import { FakeLlmClient } from './fake-llm-client';

describe('FakeLlmClient — deterministic capability gap by tier', () => {
  const freeform = 'Dijual apartemen Pakubuwono View unit 15A 4.5M furnished 08123456789';

  it('cheap tier does template-only extraction (misses prose)', async () => {
    const llm = new FakeLlmClient();
    const draft = await llm.extract(freeform, 'cheap');
    expect(draft.harga).toBeUndefined(); // no "Key : Value" lines to read
  });

  it('mid tier enriches from free-form prose', async () => {
    const llm = new FakeLlmClient();
    const draft = await llm.extract(freeform, 'mid');
    expect(draft.harga).toBe('4.5M');
    expect(draft.nama_properti).toMatch(/Pakubuwono View/);
    expect(draft.owner_phone).toBeTruthy();
  });

  it('reads the explicit template at any tier', async () => {
    const llm = new FakeLlmClient();
    const draft = await llm.extract('Nama Properti : South Hills\nHarga Jual : 2M', 'cheap');
    expect(draft.nama_properti).toBe('South Hills');
    expect(draft.harga_jual).toBe('2M');
  });
});
