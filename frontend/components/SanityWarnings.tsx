import type { SanityWarning } from '@/lib/types';

/**
 * Non-blocking plausibility warnings ("are you sure?"). The listing is still
 * saved; this just asks a human to confirm a value that looks off (a 1000x price
 * typo, an implausible area). Renders nothing when there's nothing to flag.
 */
export function SanityWarnings({ warnings }: { warnings: SanityWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div data-testid="sanity-warnings" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-amber-900">
        <span aria-hidden>⚠️</span>
        Please confirm {warnings.length === 1 ? 'this value' : 'these values'}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
        {warnings.map((w) => (
          <li key={w.code}>{w.message}</li>
        ))}
      </ul>
    </div>
  );
}
