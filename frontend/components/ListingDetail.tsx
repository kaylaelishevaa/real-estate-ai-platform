'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KeyedMutator } from 'swr';
import type { ListingDetail as Detail, UpdateListingPayload } from '@/lib/types';
import { updateListing, deleteListing } from '@/lib/api';
import { STATUS_META, humanizeField } from '@/lib/format';
import { ParsedFields } from './ParsedFields';
import { EditListingForm } from './EditListingForm';
import { ConfirmDelete } from './ConfirmDelete';

/**
 * Review/edit/delete surface for one listing — the human-in-the-loop correction
 * step. Edit applies a validated PATCH (optimistic, rolls back on error);
 * delete removes the listing and returns to the list.
 */
export function ListingDetail({ detail, mutate }: { detail: Detail; mutate: KeyedMutator<Detail> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleSave(payload: UpdateListingPayload) {
    setSaving(true);
    setError(null);

    // Optimistic: reflect the edit immediately, then confirm with the server.
    const optimistic: Detail = {
      ...detail,
      harga: payload.harga_jual ?? payload.harga_sewa ?? detail.harga,
      listing: { ...detail.listing, ...(payload as Partial<Detail['listing']>) },
    };
    void mutate(optimistic, { revalidate: false });

    try {
      const updated = await updateListing(detail.id, payload);
      await mutate(updated, { revalidate: false });
      setEditing(false);
    } catch (e) {
      await mutate(detail, { revalidate: false }); // rollback
      setError(e instanceof Error ? e.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteListing(detail.id);
      router.push('/listings');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete listing');
    }
  }

  const l = detail.listing;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {l.nama_properti_normalized ?? l.nama_properti ?? 'Untitled'}
              {l.unit ? <span className="text-slate-400"> · {l.unit}</span> : null}
            </h1>
            <span
              data-testid="status-badge"
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_META[detail.status].classes}`}
            >
              {STATUS_META[detail.status].label}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {l.tipe_properti ?? '—'} · {l.tipe_listing ?? '—'} · {l.channel} · revision {detail.revision}
          </p>
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="edit-button"
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
              className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
            <ConfirmDelete onConfirm={handleDelete} />
          </div>
        )}
      </div>

      {detail.status === 'draft' && detail.missing.length > 0 && !editing && (
        <div data-testid="draft-missing" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-medium">Draft</span> — complete these to activate:{' '}
          {detail.missing.map(humanizeField).join(', ')}
        </div>
      )}

      {deleteError && (
        <div data-testid="delete-error" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {deleteError}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {editing ? (
          <EditListingForm
            listing={l}
            saving={saving}
            error={error}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <ParsedFields listing={l} />
        )}
      </div>
    </div>
  );
}
