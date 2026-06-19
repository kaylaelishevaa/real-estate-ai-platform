/**
 * `npm run eval` — the correctness harness.
 *
 * This is the centerpiece: a runnable evaluation of the LLM pipeline over
 * fabricated fixtures that asserts the four invariants and prints a pass/fail
 * report. It runs with NO database and NO network (FakeLlmClient). Exit code is
 * non-zero if any gate fails, so it doubles as a CI check.
 *
 * The four gates:
 *   1. Parsed fields match the source message.
 *   2. Republish does NOT double-create.
 *   3. No record is written without its chat history first.
 *   4. The input whitelist fails closed on unknown message types.
 */

import {
  ListingIngestPipeline,
  FakeLlmClient,
  OrderedListingWriter,
  InMemoryListingStore,
  InMemoryChatHistoryStore,
  WriteOrderError,
  normalizeListing,
  listingKey,
  filterInbound,
  type ParsedListing,
} from '../src/core';
import { LISTING_FIXTURES, REJECTED_MESSAGES } from './fixtures';

// ── tiny test harness ────────────────────────────────────────────────────────
let failures = 0;
const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`   ${G}✓${X} ${label}${detail ? ` ${DIM}${detail}${X}` : ''}`);
  } else {
    failures++;
    console.log(`   ${R}✗ ${label}${detail ? ` — ${detail}` : ''}${X}`);
  }
}

function gate(title: string, body: () => void): void {
  console.log(`\n${B}${title}${X}`);
  body();
}

// ── Gate 4: whitelist fails closed (sync, no LLM) ────────────────────────────
function gateWhitelist(): void {
  gate('GATE 4 — input whitelist fails closed on unknown message types', () => {
    for (const msg of REJECTED_MESSAGES) {
      const r = filterInbound(msg);
      const label = `reject ${JSON.stringify(msg)?.slice(0, 48) ?? 'null'}`;
      check(label, r.accepted === false, r.accepted ? 'was accepted!' : '');
    }
    // and the allowed types still pass
    check(
      'accept a real text message',
      filterInbound({ type: 'text', from: '628', text: 'Jual apartemen' }).accepted === true,
    );
  });
}

// ── Gate 3a: write-order — no record without history (sync) ──────────────────
function gateWriteOrderUnit(): void {
  gate('GATE 3 — no record is written without its chat history first', () => {
    const history = new InMemoryChatHistoryStore();
    const listings = new InMemoryListingStore();
    const writer = new OrderedListingWriter(history, listings);
    const listing = normalizeListing({ nama_properti: 'pakview', unit: '15A', harga_jual: '4.5M' });

    let threw = false;
    try {
      writer.commit(listing, []); // no history
    } catch (e) {
      threw = e instanceof WriteOrderError;
    }
    check('commit without history throws WriteOrderError', threw);
    check('record store is still empty after the failed commit', listings.size() === 0);

    // happy path: history is present before the record exists
    const out = writer.commit(listing, [{ from: '628', text: 'Jual pakview 15A 4.5M' }]);
    const key = listingKey(listing);
    check('on success, history exists for the listing key', history.has(key));
    check('on success, the record is created', out.created === true);
  });
}

// ── async gates (need the LLM pipeline) ──────────────────────────────────────
async function gateFieldMatch(): Promise<void> {
  console.log(`\n${B}GATE 1 — parsed fields match the source message${X}`);
  for (const fx of LISTING_FIXTURES) {
    const pipe = new ListingIngestPipeline(new FakeLlmClient());
    const r = await pipe.ingest(fx.message);
    console.log(`  ${DIM}${fx.name}${X}`);
    check('status', r.status === fx.expectStatus, `${r.status} vs ${fx.expectStatus}`);
    if (fx.expectTier) check('model tier', r.tier === fx.expectTier, `${r.tier} vs ${fx.expectTier}`);

    if (fx.expectFields && r.listing) {
      for (const [k, want] of Object.entries(fx.expectFields)) {
        const got = (r.listing as Record<string, unknown>)[k];
        check(`field ${k}`, got === want, `${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
      }
    }
    if (fx.expectMissing) {
      const missing = r.missing ?? [];
      for (const m of fx.expectMissing) check(`missing includes ${m}`, missing.includes(m));
    }
  }
}

async function gateRepublish(): Promise<void> {
  console.log(`\n${B}GATE 2 — republish does NOT double-create${X}`);
  const pipe = new ListingIngestPipeline(new FakeLlmClient());
  const written = LISTING_FIXTURES.filter((f) => f.expectStatus === 'written');

  for (const fx of written) await pipe.ingest(fx.message); // first pass
  const afterFirst = pipe.listings.size();

  let allNoOp = true;
  for (const fx of written) {
    const r = await pipe.ingest(fx.message); // republish
    if (r.created !== false) allNoOp = false;
  }
  check('first pass created one row per distinct listing', afterFirst === written.length, `${afterFirst} rows`);
  check('republishing every fixture is a no-op (created=false)', allNoOp);
  check('store size unchanged after republish', pipe.listings.size() === afterFirst, `${pipe.listings.size()} rows`);
}

async function gateHistoryBacksEveryRecord(): Promise<void> {
  console.log(`\n${B}GATE 3 (cont.) — every written record has chat history${X}`);
  const pipe = new ListingIngestPipeline(new FakeLlmClient());
  for (const fx of LISTING_FIXTURES) {
    const r = await pipe.ingest(fx.message);
    if (r.status === 'written' && r.listing) {
      const key = listingKey(r.listing as ParsedListing);
      check(`history present for "${fx.name.slice(0, 32)}…"`, pipe.history.has(key));
    }
  }
}

async function main(): Promise<void> {
  console.log(`${B}Listing parser — correctness eval${X} ${DIM}(no DB, no network)${X}`);
  await gateFieldMatch();
  await gateRepublish();
  gateWriteOrderUnit();
  await gateHistoryBacksEveryRecord();
  gateWhitelist();

  console.log('');
  if (failures === 0) {
    console.log(`${G}${B}ALL GATES PASSED${X}`);
    process.exit(0);
  } else {
    console.log(`${R}${B}${failures} CHECK(S) FAILED${X}`);
    process.exit(1);
  }
}

void main();
