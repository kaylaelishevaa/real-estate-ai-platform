/**
 * Which required fields are still missing from a normalized listing.
 *
 * This is the "don't write a half-listing" gate. The required set depends on
 * the channel and property type — a Direct listing must name its owner, a house
 * must state land area, etc. The bot uses the returned list to ask the agent for
 * exactly what's missing instead of guessing.
 */

import type { ParsedListing } from '../types';

const FIELD_LABELS: Record<string, string> = {
  channel: 'Jalur Pemasaran (Direct/Cobroke)',
  tipe_listing: 'Tipe Listing (Jual/Sewa)',
  harga: 'Harga',
  tipe_properti: 'Tipe Properti',
  nama_properti: 'Nama Properti',
  unit: 'Unit/Nomor Unit',
  owner_name: 'Nama Owner',
  owner_phone: 'No HP Owner',
  kamar_tidur: 'Kamar Tidur',
  kamar_mandi: 'Kamar Mandi',
  luas_bangunan: 'Luas Bangunan (m²)',
  luas_tanah: 'Luas Tanah (m²)',
};

/** Per-type extra required fields. */
const TYPE_REQUIRED: Record<string, (keyof ParsedListing)[]> = {
  Apartemen: ['kamar_tidur', 'kamar_mandi', 'luas_bangunan'],
  Rumah: ['kamar_tidur', 'kamar_mandi', 'luas_bangunan', 'luas_tanah'],
  Kantor: ['luas_bangunan'],
  Ruko: ['luas_bangunan', 'luas_tanah'],
  Tanah: ['luas_tanah'],
  Gudang: ['luas_bangunan', 'luas_tanah'],
  Hotel: ['luas_bangunan', 'luas_tanah'],
  'Ruang Usaha': ['luas_bangunan', 'luas_tanah'],
  Gedung: ['luas_bangunan', 'luas_tanah'],
};

function isEmpty(v: unknown): boolean {
  return v == null || v === '';
}

/** Returns the keys of required fields that are missing. Empty = ready to write. */
export function validateListing(listing: ParsedListing): string[] {
  const missing: string[] = [];

  // Universal requirements.
  for (const f of ['tipe_listing', 'tipe_properti', 'nama_properti'] as const) {
    if (isEmpty(listing[f])) missing.push(f);
  }
  if (isEmpty(listing.harga) && isEmpty(listing.harga_jual) && isEmpty(listing.harga_sewa)) {
    missing.push('harga');
  }

  // Direct listings must identify the owner; cobroke listings need not.
  if (listing.channel === 'Direct') {
    if (isEmpty(listing.unit)) missing.push('unit');
    if (isEmpty(listing.owner_name)) missing.push('owner_name');
    if (isEmpty(listing.owner_phone)) missing.push('owner_phone');
  }

  // Per property type.
  for (const f of TYPE_REQUIRED[listing.tipe_properti ?? ''] ?? []) {
    if (isEmpty(listing[f])) missing.push(f);
  }

  return missing;
}

export function formatMissing(missing: string[]): string {
  return missing.map((f) => `- ${FIELD_LABELS[f] ?? f}`).join('\n');
}
