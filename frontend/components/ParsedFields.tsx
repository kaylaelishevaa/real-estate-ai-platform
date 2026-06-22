import type { ListingFields } from '@/lib/types';
import { formatMoney } from '@/lib/format';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value ?? <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

/** The structured result grid for a parsed listing. */
export function ParsedFields({ listing }: { listing: ListingFields }) {
  const salePrice = listing.harga_jual ?? (listing.rent_period ? null : listing.harga);
  return (
    <div data-testid="parsed-fields" className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Field label="Property" value={listing.nama_properti_normalized ?? listing.nama_properti} />
        <Field label="Type" value={listing.tipe_properti} />
        <Field label="Tower" value={listing.tower_name} />
        <Field label="Unit" value={listing.unit} />
        <Field label="Listing" value={listing.tipe_listing} />
        <Field label="Channel" value={listing.channel} />
        <Field label="Sale price" value={salePrice != null ? formatMoney(salePrice, listing.currency) : null} />
        <Field
          label="Rent price"
          value={listing.harga_sewa != null ? formatMoney(listing.harga_sewa, listing.currency, listing.rent_period) : null}
        />
        <Field label="Negotiable" value={listing.negotiable ? 'Yes' : null} />
        <Field label="Condition" value={listing.kondisi} />
        <Field label="Bedrooms" value={listing.kamar_tidur} />
        <Field label="Bathrooms" value={listing.kamar_mandi} />
        <Field label="Building area" value={listing.luas_bangunan != null ? `${listing.luas_bangunan} m²` : null} />
        <Field label="Land area" value={listing.luas_tanah != null ? `${listing.luas_tanah} m²` : null} />
        <Field label="Certificate" value={listing.sertifikat} />
        <Field label="Owner" value={listing.owner_name} />
        <Field label="Owner phone" value={listing.owner_phone} />
      </dl>

      {listing.notes && (
        <div data-testid="notes-block" className="rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Notes</p>
          <p className="text-sm text-slate-700">{listing.notes}</p>
        </div>
      )}
    </div>
  );
}
