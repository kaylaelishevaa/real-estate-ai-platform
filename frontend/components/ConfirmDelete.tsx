'use client';

import { useState } from 'react';

/** A delete button that reveals an inline confirm step before firing onConfirm. */
export function ConfirmDelete({
  onConfirm,
  label = 'Delete',
}: {
  onConfirm: () => void | Promise<void>;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span data-testid="confirm-delete" className="inline-flex items-center gap-2 text-xs">
        <span className="text-slate-600">Delete?</span>
        <button
          type="button"
          data-testid="confirm-delete-yes"
          disabled={busy}
          onClick={handleConfirm}
          className="rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Confirm'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="delete-button"
      onClick={() => setConfirming(true)}
      className="rounded-md border border-rose-200 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
    >
      {label}
    </button>
  );
}
