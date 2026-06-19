/**
 * `npm run demo` — end-to-end listing parse, no DB and no network.
 *
 * Feeds a fabricated WhatsApp broadcast through the real pipeline and prints the
 * parsed + validated listing and which model tier handled it. By default it uses
 * the deterministic FakeLlmClient; if ANTHROPIC_API_KEY is set it uses live
 * Claude with the same escalation tiers.
 *
 *   npm run demo                 # runs the built-in showcase messages
 *   npm run demo -- "your text"  # parse your own broadcast
 */

import {
  ListingIngestPipeline,
  FakeLlmClient,
  AnthropicLlmClient,
  type ListingLlmClient,
  type IngestResult,
  type InboundMessage,
} from '../src/core';

const B = '\x1b[1m', DIM = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m';

const SHOWCASE: string[] = [
  // Clean template — a cheap model handles this.
  [
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
    'Owner : Pak Budi',
    'HP Owner : 0812-3456-789',
  ].join('\n'),
  // Messy bilingual free-form — low confidence on the cheap tier, escalates.
  'Dijual cepat apt pakview tower Redwood unit 12B, 2BR 1KM LB 80, 6.3M nego ' +
    'furnished, owner Bu Sari 081299990001 direct',
  // A non-listing message that fails the whitelist.
  '__REJECT__',
];

function fmtMoney(n: number | null): string {
  return n == null ? '—' : 'Rp ' + n.toLocaleString('id-ID');
}

function pickLlm(): { llm: ListingLlmClient; label: string } {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return { llm: new AnthropicLlmClient(key), label: 'live Claude (ANTHROPIC_API_KEY set)' };
  return { llm: new FakeLlmClient(), label: 'deterministic fake (no network)' };
}

function printResult(message: InboundMessage, r: IngestResult): void {
  console.log(`${DIM}┌─ inbound (${message.type})${X}`);
  for (const line of (message.text ?? '(no text)').split('\n')) console.log(`${DIM}│${X} ${line}`);
  console.log(`${DIM}└─${X}`);

  if (r.status === 'rejected') {
    console.log(`${Y}■ REJECTED by whitelist${X} — ${r.reason}`);
    console.log(`${DIM}  (no record created — this is the phantom-record fix)${X}\n`);
    return;
  }

  if (r.attempts) {
    const trail = r.attempts.map((a) => `${a.tier}:${a.score.toFixed(2)}`).join(' → ');
    console.log(`${C}model tier:${X} ${B}${r.tier}${X}   ${DIM}escalation: ${trail}${X}`);
  }
  console.log(`${C}confidence:${X} ${r.confidence?.score}` + (r.confidence?.reasons.length ? ` ${DIM}(${r.confidence.reasons.join('; ')})${X}` : ''));

  if (r.status === 'needs_more_info') {
    console.log(`${Y}■ NEEDS MORE INFO${X} — missing: ${r.missing?.join(', ')}`);
    console.log(`${DIM}  (validated before writing — never persists a half-listing)${X}\n`);
    return;
  }

  const l = r.listing!;
  console.log(`${G}■ ${r.created ? 'WRITTEN' : 'REPUBLISHED (no-op, rev ' + r.revision + ')'}${X}`);
  console.log(`  ${B}${l.nama_properti_normalized}${X}${l.tower_name ? ` · Tower ${l.tower_name}` : ''} · unit ${l.unit}`);
  console.log(`  ${l.tipe_properti} · ${l.tipe_listing} · ${l.channel}`);
  const prices = [
    l.harga_jual != null ? `jual ${fmtMoney(l.harga_jual)}` : null,
    l.harga_sewa != null ? `sewa ${fmtMoney(l.harga_sewa)}` : null,
  ].filter(Boolean);
  console.log(`  ${prices.length ? prices.join('  ') : `price ${fmtMoney(l.harga)}`}`);
  console.log(`  ${l.kamar_tidur ?? '—'}BR / ${l.kamar_mandi ?? '—'}KM · LB ${l.luas_bangunan ?? '—'} · LT ${l.luas_tanah ?? '—'} · ${l.kondisi ?? '—'}`);
  console.log(`  owner ${l.owner_name ?? '—'} ${l.owner_phone ?? ''}`);
  console.log('');
}

async function main(): Promise<void> {
  const { llm, label } = pickLlm();
  console.log(`${B}Listing parser demo${X} ${DIM}— LLM: ${label}${X}\n`);

  const custom = process.argv.slice(2).join(' ').trim();
  const inputs = custom ? [custom] : SHOWCASE;

  // One pipeline so the republish demo can show idempotency.
  const pipe = new ListingIngestPipeline(llm);
  for (const raw of inputs) {
    const message: InboundMessage =
      raw === '__REJECT__'
        ? ({ type: 'location', from: '628120000000' } as InboundMessage)
        : { type: 'text', from: '628120000000', text: raw };
    printResult(message, await pipe.ingest(message));
  }

  // Show idempotent republish on the first showcase message.
  if (!custom) {
    console.log(`${DIM}— republishing the first broadcast verbatim —${X}`);
    const first: InboundMessage = { type: 'text', from: '628120000000', text: SHOWCASE[0] };
    printResult(first, await pipe.ingest(first));
  }
}

void main();
