/**
 * Fabricated eval fixtures.
 *
 * Every value here is invented for this public sample — no real owners, phones,
 * buildings, or agents. Each listing fixture pairs an inbound message with the
 * fields the pipeline MUST extract, plus the expected status and the model tier
 * that should handle it.
 */

import type { InboundMessage, ParsedListing, ModelTier, ListingStatus } from '../src/core';
import type { IngestStatus } from '../src/core/pipeline/ingest-listing';

export interface ListingFixture {
  name: string;
  message: InboundMessage;
  expectStatus: IngestStatus;
  /** Record status when written: 'active' (complete) or 'draft' (missing fields). */
  expectRecordStatus?: ListingStatus;
  expectTier?: ModelTier;
  /** Subset of normalized fields that must match exactly. */
  expectFields?: Partial<ParsedListing>;
  /** For draft cases: keys that must appear in `missing`. */
  expectMissing?: string[];
}

const text = (t: string): InboundMessage => ({ type: 'text', from: '628000000001', text: t });

export const LISTING_FIXTURES: ListingFixture[] = [
  {
    name: 'clean template, Direct apartment → cheap tier suffices',
    message: text(
      [
        'Jalur : Direct',
        'Nama Properti : Pakubuwono View',
        'Unit : 15A',
        'Tipe Properti : Apartemen',
        'Tipe Listing : Jual',
        'Harga Jual : 4.5M',
        'Kamar Tidur : 2',
        'Kamar Mandi : 1',
        'Luas Bangunan : 76',
        'Kondisi : Furnished',
        'Owner : Budi',
        'HP Owner : 08123456789',
      ].join('\n'),
    ),
    expectStatus: 'written',
    expectRecordStatus: 'active',
    expectTier: 'cheap',
    expectFields: {
      tipe_properti: 'Apartemen',
      nama_properti_normalized: 'Pakubuwono View',
      unit: '15A',
      channel: 'Direct',
      tipe_listing: 'Jual',
      harga: 4_500_000_000,
      kondisi: 'Furnished',
      owner_phone: '628123456789',
    },
  },
  {
    name: 'messy bilingual free-form → escalates to stronger model',
    message: text(
      'Dijual apartemen Pakubuwono View tower Redwood unit 15A, 2BR 1KM LB 76, ' +
        '4.5M nego, furnished, owner Pak Budi 08123456789 direct',
    ),
    expectStatus: 'written',
    expectRecordStatus: 'active',
    expectTier: 'mid',
    expectFields: {
      tipe_properti: 'Apartemen',
      nama_properti_normalized: 'Pakubuwono View',
      tower_name: 'Redwood',
      harga: 4_500_000_000,
      tipe_listing: 'Jual',
      channel: 'Direct',
      owner_name: 'Budi',
    },
  },
  {
    name: 'shorthand alias expands to canonical name',
    message: text(
      [
        'Jalur : Direct',
        'Nama Properti : pakview',
        'Unit : 9C',
        'Tipe Listing : Jual',
        'Harga Jual : 3.8M',
        'Kamar Tidur : 1',
        'Kamar Mandi : 1',
        'Luas Bangunan : 55',
        'Owner : Sari',
        'HP Owner : 08129990001',
      ].join('\n'),
    ),
    expectStatus: 'written',
    expectRecordStatus: 'active',
    expectFields: {
      tipe_properti: 'Apartemen', // inferred from the alias
      nama_properti_normalized: 'Pakubuwono View',
      harga: 3_800_000_000,
    },
  },
  {
    name: 'USD rent — currency + period, complete Cobroke → active',
    message: text(
      'Disewakan apartemen Riverside Residence, cobroke, 2BR 2KM LB 90, USD 2,500/month furnished',
    ),
    expectStatus: 'written',
    expectRecordStatus: 'active',
    expectTier: 'mid',
    expectFields: {
      tipe_properti: 'Apartemen',
      channel: 'Cobroke',
      tipe_listing: 'Sewa',
      harga_sewa: 2500,
      currency: 'USD',
      rent_period: 'month',
    },
  },
  {
    name: 'Cobroke house — owner not required, land area is',
    message: text(
      [
        'Jalur : Cobroke',
        'Nama Properti : Green Valley Residence',
        'Tipe Properti : Rumah',
        'Tipe Listing : Jual',
        'Harga Jual : 5.5M',
        'Kamar Tidur : 3',
        'Kamar Mandi : 2',
        'Luas Bangunan : 150',
        'Luas Tanah : 200',
      ].join('\n'),
    ),
    expectStatus: 'written',
    expectRecordStatus: 'active',
    expectTier: 'cheap',
    expectFields: {
      tipe_properti: 'Rumah',
      channel: 'Cobroke',
      harga: 5_500_000_000,
      luas_tanah: 200,
    },
  },
  {
    name: 'incomplete listing → saved as a draft with the missing list',
    message: text(
      ['Nama Properti : Pakubuwono View', 'Tipe Properti : Apartemen', 'Tipe Listing : Jual'].join(
        '\n',
      ),
    ),
    expectStatus: 'written',
    expectRecordStatus: 'draft',
    expectMissing: ['harga', 'unit', 'owner_name', 'owner_phone'],
  },
];

/**
 * Messages the whitelist must reject (fail closed). Audio/location/sticker etc.
 * are exactly the types that caused phantom records before the fix.
 */
export const REJECTED_MESSAGES: unknown[] = [
  { type: 'audio', from: '628000000002' },
  { type: 'video', from: '628000000002' },
  { type: 'sticker', from: '628000000002' },
  { type: 'location', from: '628000000002', latitude: -6.2, longitude: 106.8 },
  { type: 'contacts', from: '628000000002' },
  { type: 'reaction', from: '628000000002', emoji: '👍' },
  { type: 'text', from: '628000000002', text: '   ' }, // empty body
  null,
  {},
];
