import { parseWithEscalation } from './model-escalation';
import { FakeLlmClient } from '../llm/fake-llm-client';

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

const FREEFORM =
  'Dijual apartemen Pakubuwono View tower Redwood unit 15A, 2BR 1KM LB 76, ' +
  '4.5M nego, furnished, 08123456789';

describe('parseWithEscalation', () => {
  it('stays on the cheap tier when the cheap model is confident', async () => {
    const llm = new FakeLlmClient();
    const result = await parseWithEscalation(TEMPLATE, llm);

    expect(result.tier).toBe('cheap');
    expect(result.confidence.shouldEscalate).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(llm.calls.map((c) => c.tier)).toEqual(['cheap']);
  });

  it('escalates to a stronger model when the cheap parse is low-confidence', async () => {
    const llm = new FakeLlmClient();
    const result = await parseWithEscalation(FREEFORM, llm);

    // cheap tier (template-only) returns a thin draft → escalates to mid.
    expect(llm.calls.map((c) => c.tier)).toEqual(['cheap', 'mid']);
    expect(result.tier).toBe('mid');
    expect(result.confidence.score).toBeGreaterThanOrEqual(0.7);
    expect(result.attempts[0].tier).toBe('cheap');
    expect(result.attempts[0].score).toBeLessThan(result.attempts[1].score);
  });

  it('returns the best attempt even if the top tier never clears the bar', async () => {
    const llm = new FakeLlmClient();
    const result = await parseWithEscalation('hi', llm); // no listing data anywhere
    expect(llm.calls.map((c) => c.tier)).toEqual(['cheap', 'mid', 'strong']);
    expect(result.attempts).toHaveLength(3);
    // best = highest score seen; never worse than any single attempt
    const maxSeen = Math.max(...result.attempts.map((a) => a.score));
    expect(result.confidence.score).toBe(maxSeen);
  });
});
