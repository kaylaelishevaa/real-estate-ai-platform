'use client';

import { useState } from 'react';
import { parseListing } from '@/lib/api';
import type { ParseResult } from '@/lib/types';
import { humanizeField } from '@/lib/format';
import { TierBadge } from './TierBadge';
import { ConfidenceBar } from './ConfidenceBar';
import { ParsedFields } from './ParsedFields';
import { SampleBroadcasts } from './SampleBroadcasts';

function statusBanner(r: ParseResult): { text: string; classes: string } {
  if (r.status === 'rejected') {
    return { text: 'Rejected', classes: 'bg-rose-50 text-rose-800 border-rose-200' };
  }
  if (r.status === 'ignored') {
    return { text: 'Ignored', classes: 'bg-slate-50 text-slate-600 border-slate-200' };
  }
  // written — drafts are saved too, just not active yet.
  if (r.record_status === 'draft') {
    return {
      text: `Saved as draft — ${r.missing.length} field${r.missing.length === 1 ? '' : 's'} missing`,
      classes: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }
  return { text: 'Saved — active', classes: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
}

export function ParserPlayground() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await parseListing(text));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const banner = result ? statusBanner(result) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Input */}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="broadcast" className="text-sm font-medium text-slate-700">
          Paste a WhatsApp listing broadcast
        </label>
        <textarea
          id="broadcast"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Dijual apartemen ... unit 12B, 2BR 1KM, 6.3M nego furnished, owner ... direct"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white p-3 font-mono text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <SampleBroadcasts onPick={setText} />
        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Parsing…' : 'Parse listing'}
        </button>
      </form>

      {/* Output */}
      <div className="min-h-[12rem] rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {!result && !error && !loading && (
          <p data-testid="empty-state" className="text-sm text-slate-400">
            The structured result — fields, model tier, and confidence — appears here.
          </p>
        )}

        {loading && <p className="animate-pulse text-sm text-slate-400">Running the pipeline…</p>}

        {error && (
          <div data-testid="error-state" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {result && banner && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span data-testid="status-banner" className={`rounded-md border px-2.5 py-1 text-xs font-medium ${banner.classes}`}>
                {banner.text}
              </span>
              <TierBadge tier={result.tier} />
            </div>

            {result.confidence && <ConfidenceBar confidence={result.confidence} />}

            {result.status === 'rejected' && result.reason && (
              <p className="text-sm text-slate-600">
                Reason: <span className="font-medium">{result.reason}</span>
              </p>
            )}

            {result.missing.length > 0 && (
              <div data-testid="missing-fields" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <p className="mb-1 font-medium">Missing required fields:</p>
                <ul className="list-inside list-disc">
                  {result.missing.map((m) => (
                    <li key={m}>{humanizeField(m)}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.listing && <ParsedFields listing={result.listing} />}
          </div>
        )}
      </div>
    </div>
  );
}
