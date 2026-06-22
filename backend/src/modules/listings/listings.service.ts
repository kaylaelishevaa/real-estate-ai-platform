import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ListingIngestPipeline,
  FakeLlmClient,
  OpenAiLlmClient,
  validateListing,
  resolveProperty,
  parseUnit,
  cleanName,
  normalizePhone62,
  isValidPhone,
  normalizeCondition,
  normalizeChannel,
  normalizeListingType,
  normalizePropertyType,
  type ListingLlmClient,
  type InboundMessage,
  type ParsedListing,
  type ListingRecord,
  type Channel,
  type ListingType,
} from '../../core';
import type { UpdateListingDto } from './dto/update-listing.dto';

export interface ParseResponse {
  status: string;
  record_status: string | null;
  listing: ParsedListing | null;
  tier: string | null;
  confidence: { score: number; reasons: string[] } | null;
  missing: string[];
  reason: string | null;
}

export interface ListingSummary {
  id: string;
  status: string;
  missing: string[];
  nama_properti: string | null;
  tipe_properti: string | null;
  tipe_listing: string | null;
  channel: string;
  unit: string | null;
  harga: number | null;
  currency: string;
  rent_period: string | null;
  kondisi: string | null;
  revision: number;
}

/** Fabricated seed broadcasts so the listings view isn't empty on first run. */
const SEED_BROADCASTS: string[] = [
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
  [
    'Jalur : Direct',
    'Nama Properti : South Hills',
    'Unit : 9C',
    'Tipe Properti : Apartemen',
    'Tipe Listing : Sewa',
    'Harga Sewa : 35jt',
    'Kamar Tidur : 1',
    'Kamar Mandi : 1',
    'Luas Bangunan : 55',
    'Kondisi : Semi Furnished',
    'Owner : Sari',
    'HP Owner : 08129990001',
  ].join('\n'),
  [
    'Jalur : Direct',
    'Nama Properti : Casa Grande',
    'Unit : 21F',
    'Tipe Properti : Apartemen',
    'Tipe Listing : Jual',
    'Harga Jual : 3.2M',
    'Kamar Tidur : 2',
    'Kamar Mandi : 1',
    'Luas Bangunan : 68',
    'Kondisi : Unfurnished',
    'Owner : Andi',
    'HP Owner : 08127770002',
  ].join('\n'),
];

/**
 * Holds a single in-memory ingest pipeline for the whole app — the listings
 * "store" for the demo. No database: parsing runs the core pipeline (with the
 * deterministic FakeLlmClient unless OPENAI_API_KEY is set), and written
 * listings live in the pipeline's in-memory store.
 */
@Injectable()
export class ListingsService implements OnModuleInit {
  private readonly logger = new Logger(ListingsService.name);
  private readonly pipeline: ListingIngestPipeline;

  constructor(config: ConfigService) {
    const key = config.get<string>('OPENAI_API_KEY');
    const llm: ListingLlmClient = key ? new OpenAiLlmClient(key) : new FakeLlmClient();
    if (!key) this.logger.log('OPENAI_API_KEY not set — using deterministic fake LLM');
    this.pipeline = new ListingIngestPipeline(llm);
  }

  async onModuleInit(): Promise<void> {
    for (const text of SEED_BROADCASTS) {
      await this.pipeline.ingest({ type: 'text', from: 'seed', text });
    }
    this.logger.log(`Seeded ${this.pipeline.listings.size()} demo listings`);
  }

  /** Run a broadcast through the pipeline and return the structured outcome. */
  async parse(text: string): Promise<ParseResponse> {
    const message: InboundMessage = { type: 'text', from: 'demo', text };
    const r = await this.pipeline.ingest(message);
    return {
      status: r.status,
      record_status: r.recordStatus ?? null,
      listing: r.listing ?? null,
      tier: r.tier ?? null,
      confidence: r.confidence
        ? { score: r.confidence.score, reasons: r.confidence.reasons }
        : null,
      missing: r.missing ?? [],
      reason: r.reason ?? null,
    };
  }

  findAll(): ListingSummary[] {
    return this.pipeline.listings.all().map((rec) => this.toSummary(rec));
  }

  findOne(id: string): ListingSummary & { listing: ParsedListing } {
    const rec = this.pipeline.listings.get(id);
    if (!rec) throw new NotFoundException(`Listing "${id}" not found`);
    return { ...this.toSummary(rec), listing: rec.listing };
  }

  /**
   * Apply a human correction to a stored listing. Merges the provided fields,
   * re-validates with the SAME field-validation the parser uses, bumps the
   * revision, and flips status active↔draft accordingly. A correction that fills
   * the missing fields completes the draft; one that leaves it incomplete keeps
   * it a draft (the work is never lost). The listing key (the URL id) is stable.
   */
  update(id: string, dto: UpdateListingDto): ListingSummary & { listing: ParsedListing } {
    const rec = this.pipeline.listings.get(id);
    if (!rec) throw new NotFoundException(`Listing "${id}" not found`);

    const merged = this.applyPatch(rec.listing, dto);
    const status = validateListing(merged).length > 0 ? 'draft' : 'active';
    const outcome = this.pipeline.listings.upsert(id, merged, status);
    return { ...this.toSummary(outcome.record), listing: merged };
  }

  /** Delete a stored listing (the "remove a phantom/duplicate" step). */
  remove(id: string): void {
    if (!this.pipeline.listings.has(id)) {
      throw new NotFoundException(`Listing "${id}" not found`);
    }
    this.pipeline.listings.delete(id);
  }

  /** Merge editable fields into a listing, normalizing the same way the parser does. */
  private applyPatch(base: ParsedListing, dto: UpdateListingDto): ParsedListing {
    const next: ParsedListing = { ...base };

    if (dto.nama_properti !== undefined) {
      const resolved = resolveProperty(dto.nama_properti);
      next.nama_properti = dto.nama_properti;
      next.nama_properti_normalized = resolved.canonical || dto.nama_properti;
      if (next.tipe_properti == null && resolved.type) next.tipe_properti = resolved.type;
    }
    if (dto.tower_name !== undefined) next.tower_name = dto.tower_name.trim() || null;
    if (dto.unit !== undefined) {
      const { unit, unitRaw } = parseUnit(dto.unit);
      next.unit = unit;
      next.unit_raw = unitRaw;
    }
    if (dto.tipe_properti !== undefined) next.tipe_properti = normalizePropertyType(dto.tipe_properti);
    if (dto.tipe_listing !== undefined) {
      next.tipe_listing = normalizeListingType(dto.tipe_listing) ?? (dto.tipe_listing as ListingType);
    }
    if (dto.channel !== undefined) next.channel = (normalizeChannel(dto.channel) ?? 'Direct') as Channel;
    if (dto.harga !== undefined) next.harga = dto.harga;
    if (dto.harga_jual !== undefined) next.harga_jual = dto.harga_jual;
    if (dto.harga_sewa !== undefined) next.harga_sewa = dto.harga_sewa;
    if (dto.kamar_tidur !== undefined) next.kamar_tidur = dto.kamar_tidur.trim() || null;
    if (dto.kamar_mandi !== undefined) next.kamar_mandi = dto.kamar_mandi;
    if (dto.luas_bangunan !== undefined) next.luas_bangunan = dto.luas_bangunan;
    if (dto.luas_tanah !== undefined) next.luas_tanah = dto.luas_tanah;
    if (dto.lantai !== undefined) next.lantai = dto.lantai;
    if (dto.kondisi !== undefined) next.kondisi = normalizeCondition(dto.kondisi);
    if (dto.owner_name !== undefined) next.owner_name = cleanName(dto.owner_name) || null;
    if (dto.owner_phone !== undefined) {
      const phone = normalizePhone62(dto.owner_phone);
      next.owner_phone = isValidPhone(phone) ? phone : null;
    }
    if (dto.sertifikat !== undefined) next.sertifikat = dto.sertifikat.trim() || null;
    if (dto.notes !== undefined) next.notes = dto.notes.trim() || null;

    // Keep the primary price in sync with jual/sewa edits, unless harga was set
    // explicitly in the patch.
    if (dto.harga === undefined) {
      next.harga = next.harga_jual ?? next.harga_sewa ?? next.harga;
    }
    return next;
  }

  private toSummary(rec: ListingRecord): ListingSummary {
    const l = rec.listing;
    return {
      id: rec.key,
      status: rec.status,
      missing: validateListing(l),
      nama_properti: l.nama_properti_normalized ?? l.nama_properti,
      tipe_properti: l.tipe_properti,
      tipe_listing: l.tipe_listing,
      channel: l.channel,
      unit: l.unit,
      harga: l.harga,
      currency: l.currency,
      rent_period: l.rent_period,
      kondisi: l.kondisi,
      revision: rec.revision,
    };
  }
}
