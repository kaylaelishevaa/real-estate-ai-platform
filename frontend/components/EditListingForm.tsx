'use client';

import { useState } from 'react';
import type { ListingFields, UpdateListingPayload } from '@/lib/types';

const PROPERTY_TYPES = ['Apartemen', 'Rumah', 'Tanah', 'Ruko', 'Gudang', 'Kantor', 'Hotel', 'Ruang Usaha', 'Gedung'];
const LISTING_TYPES = ['Jual', 'Sewa', 'Jual & Sewa'];
const CHANNELS = ['Direct', 'Cobroke'];
const CONDITIONS = ['Furnished', 'Semi Furnished', 'Unfurnished'];

type FormState = Record<string, string>;

function initialState(l: ListingFields): FormState {
  const s = (v: string | number | null) => (v == null ? '' : String(v));
  return {
    nama_properti: s(l.nama_properti_normalized ?? l.nama_properti),
    tower_name: s(l.tower_name),
    unit: s(l.unit),
    tipe_properti: s(l.tipe_properti),
    tipe_listing: s(l.tipe_listing),
    channel: s(l.channel),
    harga_jual: s(l.harga_jual),
    harga_sewa: s(l.harga_sewa),
    kamar_tidur: s(l.kamar_tidur),
    kamar_mandi: s(l.kamar_mandi),
    luas_bangunan: s(l.luas_bangunan),
    luas_tanah: s(l.luas_tanah),
    lantai: s(l.lantai),
    kondisi: s(l.kondisi),
    owner_name: s(l.owner_name),
    owner_phone: s(l.owner_phone),
    sertifikat: s(l.sertifikat),
    notes: s(l.notes),
  };
}

const NUMBER_FIELDS = ['harga_jual', 'harga_sewa', 'kamar_mandi', 'luas_bangunan', 'luas_tanah', 'lantai'] as const;

function buildPayload(form: FormState): UpdateListingPayload {
  const payload: UpdateListingPayload = {
    nama_properti: form.nama_properti.trim(),
    tower_name: form.tower_name.trim(),
    unit: form.unit.trim(),
    tipe_properti: form.tipe_properti || undefined,
    tipe_listing: form.tipe_listing || undefined,
    channel: form.channel || undefined,
    kamar_tidur: form.kamar_tidur.trim(),
    kondisi: form.kondisi || undefined,
    owner_name: form.owner_name.trim(),
    owner_phone: form.owner_phone.trim(),
    sertifikat: form.sertifikat.trim(),
    notes: form.notes.trim(),
  };
  for (const key of NUMBER_FIELDS) {
    const raw = form[key].trim();
    if (raw !== '') (payload as Record<string, unknown>)[key] = Number(raw);
  }
  return payload;
}

function Input({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-200 px-2 py-1.5 text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
    </label>
  );
}

function Select({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-200 px-2 py-1.5 text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Controlled edit form for a parsed listing. Collects the editable fields and
 * hands a payload to onSave; the parent owns the API call + loading/error.
 */
export function EditListingForm({
  listing,
  saving,
  error,
  onSave,
  onCancel,
}: {
  listing: ListingFields;
  saving: boolean;
  error: string | null;
  onSave: (payload: UpdateListingPayload) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(listing));
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    onSave(buildPayload(form));
  }

  return (
    <form data-testid="edit-form" onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && (
        <div data-testid="edit-error" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        <Input id="nama_properti" label="Property" value={form.nama_properti} onChange={set('nama_properti')} />
        <Input id="tower_name" label="Tower" value={form.tower_name} onChange={set('tower_name')} />
        <Input id="unit" label="Unit" value={form.unit} onChange={set('unit')} />
        <Select id="tipe_properti" label="Type" value={form.tipe_properti} options={PROPERTY_TYPES} onChange={set('tipe_properti')} />
        <Select id="tipe_listing" label="Listing" value={form.tipe_listing} options={LISTING_TYPES} onChange={set('tipe_listing')} />
        <Select id="channel" label="Channel" value={form.channel} options={CHANNELS} onChange={set('channel')} />
        <Input id="harga_jual" label="Sale price (Rp)" type="number" value={form.harga_jual} onChange={set('harga_jual')} />
        <Input id="harga_sewa" label="Rent price (Rp)" type="number" value={form.harga_sewa} onChange={set('harga_sewa')} />
        <Select id="kondisi" label="Condition" value={form.kondisi} options={CONDITIONS} onChange={set('kondisi')} />
        <Input id="kamar_tidur" label="Bedrooms" value={form.kamar_tidur} onChange={set('kamar_tidur')} />
        <Input id="kamar_mandi" label="Bathrooms" type="number" value={form.kamar_mandi} onChange={set('kamar_mandi')} />
        <Input id="luas_bangunan" label="Building area (m²)" type="number" value={form.luas_bangunan} onChange={set('luas_bangunan')} />
        <Input id="luas_tanah" label="Land area (m²)" type="number" value={form.luas_tanah} onChange={set('luas_tanah')} />
        <Input id="lantai" label="Floor" type="number" value={form.lantai} onChange={set('lantai')} />
        <Input id="sertifikat" label="Certificate" value={form.sertifikat} onChange={set('sertifikat')} />
        <Input id="owner_name" label="Owner" value={form.owner_name} onChange={set('owner_name')} />
        <Input id="owner_phone" label="Owner phone" value={form.owner_phone} onChange={set('owner_phone')} />
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs uppercase tracking-wide text-slate-400">Notes</span>
        <textarea
          id="notes"
          value={form.notes}
          onChange={(e) => set('notes')(e.target.value)}
          rows={2}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
