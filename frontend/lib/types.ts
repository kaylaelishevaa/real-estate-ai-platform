/** Model escalation tier returned by the parser (cheap → mid → strong). */
export type Tier = 'cheap' | 'mid' | 'strong';

export type ParseStatus = 'written' | 'rejected' | 'ignored';
export type ListingStatus = 'draft' | 'active';
export type Currency = 'IDR' | 'USD';

/** Normalized listing fields (snake_case, as the backend returns them). */
export interface ListingFields {
  tipe_properti: string | null;
  nama_properti: string | null;
  nama_properti_normalized: string | null;
  tower_name: string | null;
  unit: string | null;
  tipe_listing: string | null;
  channel: string;
  harga: number | null;
  harga_jual: number | null;
  harga_sewa: number | null;
  currency: Currency;
  rent_period: 'month' | 'year' | null;
  negotiable: boolean;
  kamar_tidur: string | null;
  kamar_mandi: number | null;
  luas_bangunan: number | null;
  luas_tanah: number | null;
  lantai: number | null;
  kondisi: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  sertifikat: string | null;
  notes: string | null;
}

export interface Confidence {
  score: number;
  reasons: string[];
}

export interface ParseResult {
  status: ParseStatus;
  /** When written: 'draft' (missing fields) or 'active' (complete). */
  record_status: ListingStatus | null;
  listing: ListingFields | null;
  tier: Tier | null;
  confidence: Confidence | null;
  missing: string[];
  reason: string | null;
}

export interface ListingSummary {
  id: string;
  status: ListingStatus;
  missing: string[];
  nama_properti: string | null;
  tipe_properti: string | null;
  tipe_listing: string | null;
  channel: string;
  unit: string | null;
  harga: number | null;
  currency: Currency;
  rent_period: 'month' | 'year' | null;
  kondisi: string | null;
  revision: number;
}

/** GET/PATCH /api/listings/:id — summary plus the full parsed fields. */
export interface ListingDetail extends ListingSummary {
  listing: ListingFields;
}

/** Editable fields sent to PATCH /api/listings/:id (only what changed). */
export interface UpdateListingPayload {
  nama_properti?: string;
  tower_name?: string;
  unit?: string;
  tipe_properti?: string;
  tipe_listing?: string;
  channel?: string;
  harga_jual?: number;
  harga_sewa?: number;
  kamar_tidur?: string;
  kamar_mandi?: number;
  luas_bangunan?: number;
  luas_tanah?: number;
  lantai?: number;
  kondisi?: string;
  owner_name?: string;
  owner_phone?: string;
  sertifikat?: string;
  notes?: string;
}
