import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <span className="w-fit rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Sanitized public demo · fabricated data · no live keys
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Turn messy WhatsApp broadcasts into structured listings
        </h1>
        <p className="max-w-2xl text-slate-600">
          Property agents send free-form, bilingual listing messages. This demo runs each one through
          an LLM pipeline that parses, validates, and structures it — with confidence-based model
          escalation and correctness invariants. It runs on a{' '}
          <span className="font-medium text-slate-800">deterministic fake model — no API key required</span>,
          so every run gives the same result.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/parse"
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
        >
          <h2 className="font-semibold text-slate-900 group-hover:text-indigo-700">Parser playground →</h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste a broadcast and watch it become structured fields, with the model tier and
            confidence that produced it.
          </p>
        </Link>
        <Link
          href="/listings"
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
        >
          <h2 className="font-semibold text-slate-900 group-hover:text-indigo-700">Listings →</h2>
          <p className="mt-1 text-sm text-slate-600">
            The listings parsed so far this session, served by the NestJS REST API. This is an
            in-memory demo store — parsed records reset when the backend restarts.
          </p>
        </Link>
      </section>
    </div>
  );
}
