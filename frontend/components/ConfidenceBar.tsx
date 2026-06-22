import type { Confidence } from '@/lib/types';

/** A small confidence meter with the score and any reasons it was lowered. */
export function ConfidenceBar({ confidence }: { confidence: Confidence }) {
  const pct = Math.round(confidence.score * 100);
  const tone =
    confidence.score >= 0.7 ? 'bg-emerald-500' : confidence.score >= 0.4 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div data-testid="confidence">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>Confidence</span>
        <span className="font-medium text-slate-700">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {confidence.reasons.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">{confidence.reasons.join(' · ')}</p>
      )}
    </div>
  );
}
