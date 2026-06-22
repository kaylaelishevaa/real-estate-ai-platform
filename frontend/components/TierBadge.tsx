import type { Tier } from '@/lib/types';
import { TIER_META } from '@/lib/format';

/** Colored badge for the model tier that produced a parse. */
export function TierBadge({ tier }: { tier: Tier | null }) {
  if (!tier) return null;
  const meta = TIER_META[tier];
  return (
    <span
      data-testid="tier-badge"
      title={meta.note}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {meta.label} model
    </span>
  );
}
