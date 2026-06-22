# Zero-Downtime Platform Migration — a live brokerage's Laravel/PHP monolith → NestJS

*Case study. The production source is private (it runs a live business); this document is a sanitized
narrative of the engineering decisions. Company, vendor, and person names are genericized; figures are
rounded or marked illustrative.*

> **TL;DR (~5-min read).** I migrated the backend of a **live, in-production** real-estate brokerage
> platform — a catalog of several thousand listings (~2,500 currently published) — from a legacy
> Laravel/PHP monolith to a NestJS/TypeScript service **with zero planned downtime; I owned the backend
> migration end-to-end**, while the public site kept serving traffic the whole time.
> - **The hardest call:** I migrated by **introspecting and *adopting* the legacy database schema**
>   rather than doing a clean rewrite — so the existing read-only frontend kept working unchanged while
>   I swapped the engine underneath it. That shipped safely; it also carried a denormalization debt I
>   took on **knowingly** (§2).
> - **The discipline that made it safe:** a phase-gated production workflow — verified backup before any
>   destructive step, `SELECT` before `UPDATE`, transaction-wrapped writes, and *verify the live site
>   before concluding* (§3).
> - **Honest about it:** an LLM ingestion pipeline that committed to the DB before the CRM with no
>   spanning rollback (§4a); an AI image enhancer that **fabricated** room content until I constrained
>   it (§4b); and a third-party portal whose published spec was simply wrong in several places, which I
>   had to disprove by experiment (§5). All stated plainly.

The clean-room companion to this story is this very repo: the [AI listing parser](CASE_STUDY.md) is the
**rebuilt-correctly** version of the ingestion pipeline described in §4a — the write-ordering,
idempotency, and validate-don't-trust invariants here were learned the hard way in production.

---

## 1. What it was

A real-estate brokerage ran its public website, an admin panel, and a sales-ops workflow on top of a
PHP/Laravel monolith with a MySQL database. The business was live and growing: thousands of property
listings, agents adding and editing listings every day, and
listings syndicated out to external property portals.

The mandate was to move the backend onto a modern, typed, testable NestJS service **without taking the
business offline** and **without a frontend rewrite**. The frontend (a Next.js site) and the admin panel
were read-heavy clients of the database; rewriting them in lockstep would have multiplied the risk and
the timeline. So the real constraint wasn't "build a NestJS app" — it was "replace the engine of a
moving car."

Over the migration the automated test suite grew from roughly **155 to ~524 tests** (rounded) as each
subsystem was lifted, characterized, and locked down.

---

## 2. The core judgment call — adopt the legacy schema, don't rewrite it

The defining decision was how to treat the existing database.

A clean rewrite would have designed a fresh, normalized schema and migrated data into it. It's the
"correct" textbook answer — and for this situation it was the wrong one. The legacy schema was the
**live contract** between the database and a frontend I wasn't rewriting. Change the shape and I'd have
to change the frontend in the same breath, behind the same deploy, under the same downtime risk.

So I did the opposite: I **introspected the legacy MySQL schema and adopted it as-is** into the new
service (Prisma models generated against the real production tables, including their quirks — polymorphic
"listingable" associations across apartments/houses/land/shops/warehouses/offices, plain-`VARCHAR`
status fields with no DB-level enum, JSON columns for tower metadata). The NestJS service spoke the
existing tables natively, so the unchanged frontend kept reading exactly what it always had. The engine
changed; the contract didn't.

**The tradeoff I took on knowingly.** Adopting the legacy schema meant inheriting its denormalization.
The starkest example: a single `status` column conflated two genuinely different facts — *is this
listing publicly visible* and *what is the unit's deal condition* (available / sold / rented). One
field, two meanings, which made every "show or hide this listing" decision ambiguous and made an entire
class of visibility bugs possible.

The right fix is normalization, and I did it as a **deliberate, phased follow-up** rather than a
big-bang up front: split the one field into `status` (PUBLISHED/DRAFT) + `deal_status`
(AVAILABLE/SOLD/RENTED/ARCHIVED) + a canonical `is_rented`, backfilled from a reconciled source of
truth, behind a multi-phase rollout with a per-segment acceptance harness. Shipping the migration first
and normalizing second was the call that kept the business online; the normalization is the schema debt
being paid down on purpose, not an accident left lying around.

> The honest version: a clean rewrite would have been *cleaner*. It would not have been *safer*, and on
> a live platform with one engineer, safe-to-ship beats clean-on-paper. I'd make the same call again.

---

## 3. Production operations — the deploy sequence and the discipline

A migration is only as good as the operational discipline around it. The platform ran on a single
production droplet with the API and a background worker as Docker Compose services sharing one image, in
front of MySQL, Redis, and Postgres.

**The canonical deploy sequence** (learned, not assumed):

```
git pull
# only when a new DB migration exists — BEFORE the rebuild:
docker compose ... run --rm api npx prisma migrate deploy
docker compose ... build api          # api + worker share one image; building api covers both
docker compose ... up -d --force-recreate --no-deps api worker
```

Three hard-won rules are baked into those four lines:

- **Migrate before rebuild.** A worker that boots against a database missing its new columns crashes on
  startup. Schema goes first.
- **`--force-recreate --no-deps api worker`, never a bare `up -d`.** Plain `up -d` churned dependencies
  and crashed the stack; the scoped recreate touches only the two app services and leaves the datastores
  alone.
- **"Did the code actually land?" is a separate question from "did git say I pushed?"** The definitive
  check is grepping the *running container's compiled output* for a symbol from the new code —
  `docker exec <worker> grep -rl <newSymbol> dist/…`. Trusting `git HEAD` is how you conclude a fix
  shipped when the image was never rebuilt.

Around the database, every production write went through a **phase-gated manual workflow**: (1)
read-only investigation `SELECT`s, (2) a written, commented mapping/decision, (3) the `UPDATE` wrapped in
`START TRANSACTION` with **no** `COMMIT`, (4) verification `SELECT`s *inside the open transaction* before
committing or rolling back. A **verified backup/snapshot precedes any destructive step**, and the
operator — not the automation — pulls the trigger. The point of the gates isn't ceremony; it's that the
"review the results between phases" loop is where the errors the SQL *didn't anticipate* get caught.

### Vignette — the OOM mid-deploy

On a small droplet, a production rebuild got **OOM-killed mid-deploy**: the build's memory spike
collided with the running services and the kernel started reaping processes. Recovery was unglamorous
and correct — add swap to give the build headroom, then switch to the scoped `--force-recreate
--no-deps` recreate so the deploy stopped trying to churn the whole stack at once. **Lesson:** on a
single small host, a deploy is a *resource event*, not just a code event; budget memory for the build
the same way you budget it for the app.

### Vignette — the stacked legacy outage

A single user-visible symptom (a feature writing some destinations but not others) turned out to be a
**chain of independent legacy weaknesses lined up nose to tail**: a container image that hadn't been
rebuilt since the relevant commit (so newer code simply wasn't in the running container), compounding
with stale cached responses on the read path. Each layer masked the one beneath it — fix the cache and
the image is still stale; rebuild the image and the cache still serves the old answer. **Lesson:** in a
legacy system a symptom rarely has *one* cause; resist the first plausible fix and isolate layer by
layer — code-in-container, then datastore, then cache — until the symptom is *provably* gone on the live
site, not just in your terminal.

That last clause is the whole ethos: **verify the live site before concluding.** "It works on my
machine / the API returned 200" is a hypothesis, not a result.

---

## 4. The AI layers, honestly

### 4a. WhatsApp → LLM → CRM ingestion, and the integrity gap it surfaced

Agents submit listings as free-form WhatsApp messages. A pipeline parses each message with an LLM into
structured fields and writes the result into **two** systems: the website's MySQL database and the
team's CRM (a Lark-based ops backend that is the human source of truth).

The integrity gap was structural: the write touched the two stores **in sequence, with no transaction
spanning both**. A commit to the database followed by a CRM write that fails (or vice-versa) leaves the
two systems disagreeing — an orphaned or duplicated record with no automatic rollback. Two production
incidents made the shape of the risk concrete:

- A **wrong-unit mutation.** A "mark as sold" command was fuzzy-matched against the MySQL table by name +
  unit; a unit-number normalization (collapsing a leading zero) matched a *different* live unit and
  flipped it to SOLD. The real target wasn't even on the website — the correct action was a CRM-status
  change only. Remediation restored the wrongly-mutated row and corrected the CRM.
- A **duplicate record.** A name the model normalized slightly differently ("1 Park Avenue" → "1Park
  Avenue") missed an exact-match dedup lookup and created a second CRM row instead of recognizing the
  existing listing.

The durable lesson — and the design the public parser in this repo demonstrates cleanly — is a set of
invariants: **match the source of truth (the CRM) first, by a stable ID**, not by fuzzy name+unit;
**canonicalize names before any dedup decision**; and **never fuzzy-match the production DB on a
write path.** Hardening the cross-store write into something transactionally honest (provenance/CRM
first, idempotent by a content-derived key, validate before persist) was prioritized as the next
integrity pass. I treated this as a known, bounded risk with guards in place — not a solved problem I
was pretending didn't exist.

### 4b. The image enhancer that fabricated content

To make listing photos portal-ready, an AI image-enhancement service upscaled and relit them. The
problem: it didn't just enhance — it **fabricated**. It invented furniture and décor that weren't in the
room (pillows, vases, plants), and in worse cases altered the actual property: blanking a city view to a
blank wall, adding or removing fixtures, even inventing architectural features. For real-estate photos
that's not a cosmetic bug — it's misrepresenting the asset.

I traced it to an **under-constrained prompt** (the model was free to "improve" the scene) and fixed it
at two levels: constrain the prompt to forbid adding or removing real content, and add a **scored
verification gate** — a second pass that returns structured findings and rejects an enhancement when it
detects a *major* fabrication above a confidence threshold, retrying with a photo-specific corrective
instruction before giving up and preserving the original. On model choice, a side-by-side of a cheaper
"fast" tier against a stronger tier showed the stronger one was meaningfully more realistic; I let
quality win there with the cost stated explicitly.

**The cost decision, made knowingly:** enhance **only the photos of listings actively being published**,
not the entire historical library. Per-image enhancement-plus-verification cost (order ~$0.03 + ~$0.007
per photo, *illustrative*) is trivial per listing but multiplies across tens of thousands of legacy
photos into real money for marginal benefit. Enhancing at the point of publication caps the spend where
it earns its keep.

---

## 5. Multi-portal syndication — "the spec was wrong"

The platform syndicates listings to external property portals. The headline lesson of integrating with
one of them: **the published API spec was wrong in several places**, and the only way through was
empirical — send a controlled request, observe the live result, adjust. A sampling of what the docs said
versus what production actually did:

- **"Listings default to Online."** They didn't. Ads sat inactive indefinitely until the request
  *explicitly* carried the active-status field — proven with a controlled canary that activated only
  after a re-upload that included it.
- **Descriptions render as HTML.** They render as **plain text** — literal `<p>` tags showed on the live
  page until I stripped markup and decoded entities while preserving paragraph breaks.
- **The name registry the spec implied.** The portal validates a property's building name against an
  *integration registry* that is a **different dataset** from the public directory it shows on its own
  site — uploading the public-facing name was rejected as invalid. Building a verified name-mapping
  against the *integration* registry was the only thing that worked.
- **Undocumented requirements and shapes.** A location reference needed to be resolved several parent
  levels deep or validation falsely claimed the region didn't exist; a "bump"/repost feature accepted a
  bare boolean flag but rejected the extra parameter the docs implied; manually-created ads turned out to
  be **unaddressable via the API at all** (no delete or upsert key for them) — which I confirmed by
  experiment rather than inferring.

The waves shipped: roughly **950 listings** uploaded via the API in throttled, resume-safe batches with
**zero rejections and zero rate-limit retries** once the real contract was mapped. The takeaway isn't
"that portal's docs are bad" — it's that **for any integration, the live system is the spec; the
document is a hint.** Treat the published contract as a hypothesis and verify each field against
production before trusting it at scale.

---

## 6. Recurring problem classes that generalized

A few problems showed up over and over across unrelated features — the ones worth internalizing:

- **Cache invalidation across three layers.** A data change isn't "live" until it has propagated through
  the **application cache (Redis), the client's data cache (SWR), and the CDN edge**. After scrubbing a
  set of listings, the corrected text only appeared once Redis *and* the CDN were purged — the database
  being right is necessary, not sufficient. A separate incident was purely a CDN-transport problem:
  images crawled because browser "Happy Eyeballs" preferred an IPv6 path that throttled bulk throughput;
  the decisive proof was disabling IPv6 on one machine and watching a 90 KB image drop from ~5s to
  ~0.15s. The fix (point images at an IPv4-only origin) **knowingly traded away the CDN edge cache** for
  a transport that actually worked — fine for the serving region, revisit if egress grows.
- **BigInt serialization.** MySQL `BIGINT` primary keys come out of the ORM as JavaScript `BigInt`, which
  `JSON.stringify` refuses to serialize — so raw rows spread into a cached/Redis-bound payload threw at
  the boundary. The fix is a single sanitize-on-the-way-out step; the lesson is that the DB's number
  types and JSON's number types are not the same set, and the seam between them needs an explicit guard.
- **"Restart ≠ reload."** Restarting a container does **not** pick up code that was never rebuilt into its
  image; an app process does not reload source the way a dev server does. More than one "I already fixed
  that" was actually a stale artifact. The antidote is the verify-in-the-running-container check from §3.
  A close cousin bit the frontend: a server-only utility left **imported-but-unused** in a page defeated
  tree-shaking and pulled a Node built-in into the client bundle, breaking the build — proof that "it's
  not even called" is not "it's not in the bundle."
- **Schema-debt compounding.** Every place the original conflated-`status` ambiguity was relied upon (a
  visibility check that keyed on a dual-meaning flag, a join that assumed an ID was unique across types
  when it wasn't) became its own latent bug. Denormalization debt doesn't sit still; it **compounds**
  through every reader that trusts the ambiguous shape — which is exactly why normalizing it (§2) is
  worth doing as real, prioritized work.

---

## 7. Design decisions & roadmap

The shape of this system is the sum of a few deliberate calls and a clear forward direction.

**Decisions made knowingly:**

- **Adopt the legacy schema to ship safely** (§2). Speaking the existing tables let a live frontend keep
  working through an engine swap. The denormalization that came with it is being resolved by design, not
  discovered by accident.
- **Enhance images at the point of publication, not across the whole library** (§4b). Cost is spent where
  it converts; the verification gate keeps the model honest.
- **The live system is the integration contract** (§5). Empirical verification against production is the
  default posture for every external API, not a fallback.

**Where the architecture is headed:**

- **Schema normalization, completed.** Finish carrying the `status` → `status` + `deal_status` +
  canonical `is_rented` split through every reader, so visibility is decided by one unambiguous rule
  instead of an overloaded field. This is the structural payoff the safe-migration order was designed to
  enable.
- **Automated, layer-aware cache invalidation.** Turn the manual "purge Redis + CDN after a data change"
  step into an automatic, event-driven invalidation across all three cache layers — so "the database is
  correct" and "the live site is correct" stop being two separate facts.
- **Transactionally honest cross-store writes.** Evolve the WhatsApp → DB → CRM path toward the
  write-ordering and idempotency invariants demonstrated in this repo's [parser case study](CASE_STUDY.md):
  source-of-truth first, idempotent by content key, validate before persist.

The throughline: **ship safely on a live system, then improve it on purpose** — with the tradeoffs
written down instead of hidden.

---

## 8. Stack (sanitized)

- **Backend:** NestJS · TypeScript · Prisma (introspected against the legacy MySQL schema) · BullMQ/Redis
  queues · Docker Compose on a single production droplet (API + background worker sharing one image).
- **Datastores:** MySQL (the adopted legacy schema) · Redis (cache + queues) · Postgres (auxiliary).
- **Frontend / admin:** Next.js (read-heavy clients kept working unchanged through the migration) ·
  SWR client cache · a CDN edge in front of object-storage media.
- **AI:** an LLM extraction pipeline (provider-neutral) turning free-form WhatsApp messages into
  structured listings; an AI image-enhancement service with a scored verification gate.
- **Integrations:** a Lark-based CRM as the human source of truth; syndication to external property
  portals over their APIs; a legacy portal's URLs consolidated into the main site via a redirect map.
- **Discipline:** phase-gated manual production-DB workflow, verified backups before destructive steps,
  ~524 automated tests.

---

*Companion docs in this repo: the [parser case study](CASE_STUDY.md) (the ingestion pipeline rebuilt
clean) and the [architecture overview](ARCHITECTURE.md).*
