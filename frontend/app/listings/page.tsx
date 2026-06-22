'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { getListings, deleteListing } from '@/lib/api';
import { ListingsTable } from '@/components/ListingsTable';

type SortOrder = 'newest' | 'oldest';
type StatusFilter = 'all' | 'active' | 'draft';

export default function ListingsPage() {
  const { data, error, isLoading, mutate } = useSWR('listings', getListings, {
    revalidateOnFocus: false,
  });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>('newest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // The API returns listings in creation order, so "newest" is just the reverse.
  const rows = useMemo(() => {
    let arr = [...(data ?? [])];
    if (statusFilter !== 'all') arr = arr.filter((r) => r.status === statusFilter);
    if (sort === 'newest') arr.reverse();
    return arr;
  }, [data, sort, statusFilter]);

  async function handleDelete(id: string) {
    setDeleteError(null);
    const previous = data ?? [];
    // Optimistic removal.
    await mutate(previous.filter((r) => r.id !== id), { revalidate: false });
    try {
      await deleteListing(id);
    } catch (e) {
      await mutate(previous, { revalidate: false }); // rollback
      setDeleteError(e instanceof Error ? e.message : 'Could not delete listing');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Listings</h1>
        <p className="text-sm text-slate-600">
          Seeded fabricated listings plus anything parsed this session — served by{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">GET /api/listings</code>. Click a
          row to review, edit, or delete.
        </p>
      </header>

      {data && data.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">Sort</span>
            <select
              data-testid="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOrder)}
              className="rounded-md border border-slate-200 px-2 py-1 text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">Status</span>
            <select
              data-testid="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-md border border-slate-200 px-2 py-1 text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <span className="text-xs text-slate-400">
            Showing {rows.length} of {data.length}
          </span>
        </div>
      )}

      {isLoading && <p className="animate-pulse text-sm text-slate-400">Loading listings…</p>}

      {error && (
        <div data-testid="error-state" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error instanceof Error ? error.message : 'Could not load listings.'}
        </div>
      )}

      {deleteError && (
        <div data-testid="delete-error" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {deleteError}
        </div>
      )}

      {data && rows.length === 0 && data.length > 0 ? (
        <p className="text-sm text-slate-400">No {statusFilter} listings.</p>
      ) : (
        data && <ListingsTable rows={rows} onDelete={handleDelete} />
      )}
    </div>
  );
}
