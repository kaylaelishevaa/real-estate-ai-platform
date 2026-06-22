import Link from 'next/link';
import type { ListingSummary } from '@/lib/types';
import { formatMoney, STATUS_META } from '@/lib/format';
import { ConfirmDelete } from './ConfirmDelete';

function StatusBadge({ status }: { status: 'draft' | 'active' }) {
  const meta = STATUS_META[status];
  return (
    <span
      data-testid="status-badge"
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

/** Presentational table of listings. Fetching + delete handling live in the page. */
export function ListingsTable({
  rows,
  onDelete,
}: {
  rows: ListingSummary[];
  onDelete?: (id: string) => void | Promise<void>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">No listings yet — parse one in the playground.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Property</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Unit</th>
            <th className="px-4 py-3 font-medium">Listing</th>
            <th className="px-4 py-3 font-medium">Channel</th>
            <th className="px-4 py-3 font-medium">Price</th>
            <th className="px-4 py-3 font-medium">Rev</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} data-testid="listing-row" className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/listings/${encodeURIComponent(r.id)}`}
                  className="text-slate-800 hover:text-indigo-700 hover:underline"
                >
                  {r.nama_properti ?? '—'}
                </Link>
              </td>
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
              <td className="px-4 py-3 text-slate-600">{r.tipe_properti ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{r.unit ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{r.tipe_listing ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{r.channel}</td>
              <td className="px-4 py-3 text-slate-600">{formatMoney(r.harga, r.currency, r.rent_period)}</td>
              <td className="px-4 py-3 text-slate-400">{r.revision}</td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/listings/${encodeURIComponent(r.id)}`}
                    className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    View
                  </Link>
                  {onDelete && <ConfirmDelete onConfirm={() => onDelete(r.id)} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
