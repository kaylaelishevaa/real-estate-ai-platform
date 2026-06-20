# Real Estate AI — WhatsApp Listing Parser

[![CI](https://github.com/kaylaelishevaa/real-estate-ai-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/kaylaelishevaa/real-estate-ai-platform/actions/workflows/ci.yml)

> A **sanitized public extract** of a private production system. Property agents
> submit listings as free-form WhatsApp broadcasts; an LLM pipeline turns them
> into structured, validated records written to a website DB and a CRM. All
> names, buildings, phones, and credentials here are fabricated.

The interesting part isn't "call an LLM to extract fields." It's everything that
makes an LLM safe to put in a write path: **measuring** correctness, **validating**
the model's output instead of trusting it, spending the **expensive model only
when it changes the answer**, and enforcing **invariants** that stop a flaky model
from corrupting data.

---

## The problem

A listing arrives as a message like:

```
Dijual cepat apt pakview tower Redwood unit 12B, 2BR 1KM LB 80,
6.3M nego furnished, owner Bu Sari 081299990001 direct
```

Bilingual (Indonesian/English), abbreviated (`apt`, `LB`, `2BR`), shorthand
building names (`pakview` → *Pakubuwono View*), prices in local magnitudes
(`6.3M` = 6.3 **billion** rupiah, not million), and a phone number that must
match the same owner whether written `0812…`, `+62 812…`, or `62812…`.

Get the price magnitude wrong and you publish a listing off by 1000×. Let an
unhandled message type through and you create an empty "phantom" record.
Re-process the same broadcast and you create a duplicate. This repo is about
**not doing those things**, provably.

---

## What's here

```
backend/
  src/core/            ← framework-agnostic, fully tested, no DB / no network
    extract/           ← deterministic parsers: price, phone, name, tower, enums
    llm/               ← LLM behind an interface + deterministic fake + OpenAI adapter
    parse/             ← normalize → validate → confidence → model escalation
    intake/            ← whitelist (fails closed)
    store/ + invariants/ ← in-memory write-target, write-ordering, idempotency
    pipeline/          ← the slim orchestrator that composes the above
  src/modules/         ← the production NestJS extract (auth, location, queues,
                         Prisma schema, security) + thin adapters over core
  eval/                ← `npm run eval`: the correctness harness
  demo/                ← `npm run demo`: one-command end-to-end parse
```

The **core** is the showcase: small, single-purpose, individually tested units.
The **NestJS layer** is the real production scaffolding the core was lifted from;
its WhatsApp worker is a thin adapter that delegates to the tested core rather
than the original 600-line god-processor (an untested god-file is a liability,
not a feature).

---

## Quickstart

```bash
cd backend
npm install
npm run demo     # parse fabricated broadcasts, print listing + model tier
npm run eval     # run the correctness gates (pass/fail report)
npm test         # 77 unit tests
npm run build    # nest build
```

No database, Redis, API key, or network is required for `demo`, `eval`, or
`test` — the LLM sits behind an interface with a deterministic fake. Set
`OPENAI_API_KEY` to run the same pipeline against live models.

### `npm run demo`

```
model tier: mid   escalation: cheap:0.00 → mid:1.00
confidence: 1
■ WRITTEN
  Pakubuwono View · Tower Redwood · unit 12B
  Apartemen · Jual · Direct
  price Rp 6.300.000.000
  2BR / 1KM · LB 80 · LT — · Furnished
  owner Sari 6281299990001
```

The cheap model returns a thin parse on this messy free-form message (confidence
0.00), so the pipeline escalates to a stronger model that resolves it, then
writes. A clean template message is handled by the cheap model alone.

---

## The measurement: `npm run eval`

> *"I measure my LLM system's correctness"* is the rarest, highest-value signal
> for an AI role — so it's the centerpiece here.

`eval/run-eval.ts` runs fabricated fixtures through the real pipeline and asserts
four correctness gates, printing a pass/fail report and exiting non-zero on any
failure (so it doubles as a CI check):

| Gate | What it proves |
|------|----------------|
| **1. Parsed fields match source** | The structured output actually reflects the message — price magnitudes, alias expansion, channel, owner, area. |
| **2. Republish does not double-create** | Re-sending the same broadcast updates one row; it never inserts a duplicate. |
| **3. No record without chat history first** | Every listing is written *after* its provenance; a write with no history is refused, not orphaned. |
| **4. Whitelist fails closed** | Audio / location / sticker / unknown / malformed messages are rejected, never silently processed. |

---

## Design decisions (the *why*)

### 1. Validate — don't trust — the LLM
The model returns a **loose draft** (`RawListingDraft`). Deterministic code then
parses every field into a typed `ParsedListing`: `parsePrice("6.3M")` → a number,
phones → one canonical key, conditions/types → closed enums. Getting a price
wrong by 1000× must never depend on model temperature, so that math lives in
unit-tested code, not the prompt. → `core/parse/normalize-listing.ts`,
`core/extract/*`

### 2. Confidence-based model escalation (cost ↔ accuracy)
Most listings are clean template messages a cheap model parses perfectly. Paying
the top-tier price for all of them is waste; using the cheap model on the messy
10% is errors. So we start cheap, **score confidence from the normalized result**
(not the model's self-report), and escalate only when it's low.

| Tier | Handles | Cost |
|------|---------|------|
| `cheap` | clean template messages (the majority) | lowest |
| `mid` | messy free-form prose | medium |
| `strong` | genuinely ambiguous / conflicting | highest |

The tiers are **provider-neutral**: the LLM sits behind a `ListingLlmClient`
interface, so the concrete model per tier lives in one adapter (an OpenAI adapter
is included; swapping providers is a single file). Tests, demo, and eval run on a
deterministic fake, so none of them depend on a live model.

→ `core/parse/confidence.ts`, `core/parse/model-escalation.ts`, `core/llm/`

### 3. Write-order invariant: history before record
A listing without the chat that produced it is an unauditable orphan and a sign
the pipeline half-failed. The writer persists provenance first, verifies it
landed, then creates the record — and **refuses** to write a record with no
history. → `core/invariants/write-order.ts`

### 4. Idempotent republish
Identity is the content `(property, tower, unit)`, not the DB row id. The same
broadcast — or an alias-equivalent one (`pakview` vs *Pakubuwono View*) —
collapses onto one record, so republishing is an in-place update, never a
duplicate. → `core/store/listing-key.ts`

### 5. Whitelist fails closed (the phantom-record fix)
Meta's webhook delivers *every* event type to one endpoint. The original bug
branched on known types and fell through on the rest, so a shared location or a
👍 reaction could advance a conversation and create an empty listing. The fix
accepts an explicit allowlist and rejects everything else — including malformed
payloads and message types that don't exist yet. → `core/intake/message-whitelist.ts`

---

## Tech

NestJS · TypeScript · Prisma (MySQL) · BullMQ/Redis · OpenAI SDK · Jest.
The parser core has zero framework or infrastructure dependencies, which is what
makes it testable offline.

## Deliberately out of scope

This is a focused extract, not the whole platform. Property-type CRUD, blog/SEO,
dashboards, mortgage tooling, user/role management, and the multi-portal sync
internals exist in the production system but are omitted here to keep the signal
high. The Lark/CRM and portal integrations are represented as interfaces and a
minimal in-memory write-target rather than live clients.
