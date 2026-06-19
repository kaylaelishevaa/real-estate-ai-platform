import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LarkBaseService } from './lark-base.service';

// ── CRM Listings table field IDs ─────────────────────────────────────────

const F = {
  unit: 'fld_unit',
  namaProperti: 'fld_property_name',
  jalurPemasaran: 'fld_marketing_channel',
  agen: 'fld_agent',
  status: 'fld_status',
  tipeListing: 'fld_listing_type',
  hargaJual: 'fld_sell_price',
  hargaSewa: 'fld_rent_price',
  kamarTidur: 'fld_bedrooms',
  lantai: 'fld_floor',
  luasBangunan: 'fld_building_area',
  luasTanah: 'fld_land_area',
  kondisi: 'fld_condition',
  notes: 'fld_notes',
  tipeProperti: 'fld_property_type',
  areaKawasan: 'fld_area',
  linkWebsite: 'fld_website_link',
  listingId: 'fld_listing_id',
  pemilik: 'fld_owner',
  kapanDilisting: 'fld_listed_at',
} as const;

export { F as LARK_LISTING_FIELDS };

export interface LarkListingInput {
  unit: string;
  namaProperti: string;
  tipeProperti: string;
  tipeListing: string; // "Jual" | "Sewa"
  harga: number;
  kamarTidur?: string;
  lantai?: number;
  luasBangunan?: number;
  luasTanah?: number;
  kondisi?: string;
  areaKawasan?: string;
  jalurPemasaran?: string; // "Direct" | "Cobroke"
  notes?: string;
  agentLarkId: string;
  contactRecordId?: string;
  mysqlPropertyId?: string;
}

@Injectable()
export class LarkListingService {
  private readonly logger = new Logger(LarkListingService.name);
  private readonly tableId: string;

  constructor(
    private readonly base: LarkBaseService,
    private readonly config: ConfigService,
  ) {
    this.tableId = config.get<string>('CRM_LISTINGS_TABLE') ?? '';
  }

  // ── SEARCH ──────────────────────────────────────────────────────────────

  /** Exact match on Nama Properti + Unit. */
  async searchByPropertyAndUnit(
    namaProperti: string,
    unit: string,
  ): Promise<{ record_id: string; fields: Record<string, unknown> } | null> {
    const filter = `AND(CurrentValue.[Nama Properti]="${namaProperti}",CurrentValue.[Unit]="${unit}")`;
    const result = await this.base.searchRecords(this.tableId, filter, 1);
    return result.items[0] ?? null;
  }

  /** Search all listings for a given property name. */
  async searchByProperty(
    namaProperti: string,
  ): Promise<Array<{ record_id: string; fields: Record<string, unknown> }>> {
    try {
      const filter = `CurrentValue.[Nama Properti]="${namaProperti}"`;
      const result = await this.base.searchRecords(this.tableId, filter, 50);
      return result.items;
    } catch (err: any) {
      this.logger.error(`searchByProperty failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Dedup search with fuzzy name + unit matching.
   *
   * Returns:
   *  - { case: 'A' } — no building match at all
   *  - { case: 'B', record } — building + unit match (duplicate)
   *  - { case: 'C' } — building exists but unit is new
   */
  async checkDuplicate(
    namaProperti: string,
    unit: string,
  ): Promise<
    | { case: 'A' }
    | { case: 'B'; record: { record_id: string; fields: Record<string, unknown> } }
    | { case: 'C' }
  > {
    this.logger.log(`Dedup search: name="${namaProperti}", unit="${unit}"`);

    if (!unit || unit.length < 1) return { case: 'A' };

    const nameVariants = this.generateNameVariants(namaProperti);
    let listings: Array<{ record_id: string; fields: Record<string, unknown> }> = [];

    for (const variant of nameVariants) {
      listings = await this.searchByProperty(variant);
      this.logger.log(`Lark search returned ${listings.length} records for property "${variant}"`);
      if (listings.length > 0) break;
    }

    if (listings.length === 0) {
      this.logger.log('Final dedup result: NO MATCH (no building found)');
      return { case: 'A' };
    }

    const parsedUnitUpper = unit.toUpperCase().replace(/[\s\-]/g, '');

    for (const item of listings) {
      const larkUnit = String(item.fields['Unit'] ?? item.fields[F.unit] ?? '');
      if (!larkUnit) continue;

      const larkUpper = larkUnit.toUpperCase().replace(/[\s\-]/g, '');
      const matched = larkUpper.includes(parsedUnitUpper);

      this.logger.log(`  Checking unit: "${larkUnit}" contains "${unit}"? ${matched}`);

      if (matched) {
        this.logger.log(`Final dedup result: MATCH ${larkUnit}`);
        return { case: 'B', record: item };
      }
    }

    this.logger.log(`Final dedup result: NO MATCH (building found, unit "${unit}" not in any record)`);
    return { case: 'C' };
  }

  /**
   * Generate name variants for fuzzy matching.
   * "Senopati Suites 2" -> ["Senopati Suites 2", "Senopati Suites", "Senopati"]
   */
  private generateNameVariants(name: string): string[] {
    const variants: string[] = [name];

    const withoutTrailingNum = name.replace(/\s+\d+$/, '').trim();
    if (withoutTrailingNum !== name && withoutTrailingNum.length > 0) {
      variants.push(withoutTrailingNum);
    }

    const withoutTrailingSuffix = name.replace(/\s+(I{1,3}|IV|V|VI{0,3}|One|Two|Three|[A-Z])$/i, '').trim();
    if (withoutTrailingSuffix !== name && !variants.includes(withoutTrailingSuffix) && withoutTrailingSuffix.length > 0) {
      variants.push(withoutTrailingSuffix);
    }

    return variants;
  }

  // ── CREATE ──────────────────────────────────────────────────────────────

  async createListing(input: LarkListingInput): Promise<string> {
    const fields: Record<string, unknown> = {
      [F.unit]: input.unit,
      [F.namaProperti]: input.namaProperti,
      [F.tipeProperti]: input.tipeProperti,
      [F.tipeListing]: input.tipeListing,
      [F.jalurPemasaran]: input.jalurPemasaran ?? 'Direct',
      [F.status]: 'Available',
      [F.agen]: [{ id: input.agentLarkId }],
      [F.kapanDilisting]: Date.now(),
    };

    if (input.tipeListing === 'Jual') {
      fields[F.hargaJual] = input.harga;
    } else {
      fields[F.hargaSewa] = String(input.harga);
    }

    if (input.kamarTidur) fields[F.kamarTidur] = input.kamarTidur;
    if (input.lantai != null) fields[F.lantai] = input.lantai;
    if (input.luasBangunan != null) fields[F.luasBangunan] = input.luasBangunan;
    if (input.luasTanah != null) fields[F.luasTanah] = input.luasTanah;
    if (input.kondisi) fields[F.kondisi] = input.kondisi;
    if (input.areaKawasan) fields[F.areaKawasan] = input.areaKawasan;
    if (input.notes) fields[F.notes] = input.notes;
    if (input.mysqlPropertyId) fields[F.listingId] = input.mysqlPropertyId;
    if (input.contactRecordId) fields[F.pemilik] = [input.contactRecordId];

    const record = await this.base.createRecord(this.tableId, fields);
    this.logger.log(`Lark listing created: ${record.record_id}`);
    return record.record_id;
  }

  // ── UPDATE ──────────────────────────────────────────────────────────────

  async updateListing(
    recordId: string,
    input: LarkListingInput,
  ): Promise<void> {
    const fields: Record<string, unknown> = {
      [F.tipeListing]: input.tipeListing,
    };

    if (input.tipeListing === 'Jual') {
      fields[F.hargaJual] = input.harga;
    } else {
      fields[F.hargaSewa] = String(input.harga);
    }

    if (input.kamarTidur) fields[F.kamarTidur] = input.kamarTidur;
    if (input.lantai != null) fields[F.lantai] = input.lantai;
    if (input.luasBangunan != null) fields[F.luasBangunan] = input.luasBangunan;
    if (input.luasTanah != null) fields[F.luasTanah] = input.luasTanah;
    if (input.kondisi) fields[F.kondisi] = input.kondisi;
    if (input.notes) fields[F.notes] = input.notes;
    if (input.contactRecordId) fields[F.pemilik] = [input.contactRecordId];

    await this.base.updateRecord(this.tableId, recordId, fields);
    this.logger.log(`Lark listing updated: ${recordId}`);
  }

  async appendAgent(recordId: string, agentLarkId: string): Promise<void> {
    const record = await this.base.getRecord(this.tableId, recordId);
    const currentAgen = record.fields[F.agen];

    const existingIds = new Set<string>();
    const agenArray: Array<{ id: string }> = [];

    if (Array.isArray(currentAgen)) {
      for (const a of currentAgen) {
        if (typeof a === 'object' && a !== null && 'id' in a) {
          const id = (a as Record<string, string>).id;
          existingIds.add(id);
          agenArray.push({ id });
        }
      }
    }

    if (!existingIds.has(agentLarkId)) {
      agenArray.push({ id: agentLarkId });
      await this.base.updateRecord(this.tableId, recordId, {
        [F.agen]: agenArray,
      });
      this.logger.log(`Agent ${agentLarkId} appended to Lark listing ${recordId}`);
    }
  }

  async updateWebsiteLink(recordId: string, url: string): Promise<void> {
    await this.base.updateRecord(this.tableId, recordId, {
      [F.linkWebsite]: { text: url, link: url },
    });
  }

  async updateStatus(recordId: string, status: string): Promise<void> {
    await this.base.updateRecord(this.tableId, recordId, {
      [F.status]: status,
    });
  }

  async updateRawFields(recordId: string, fields: Record<string, unknown>): Promise<void> {
    const nameToId: Record<string, string> = {
      'Unit': F.unit, 'Nama Properti': F.namaProperti, 'Jalur Pemasaran': F.jalurPemasaran,
      'Agen': F.agen, 'Status': F.status, 'Tipe Listing': F.tipeListing,
      'Harga Jual': F.hargaJual, 'Harga Sewa': F.hargaSewa, 'Kamar Tidur': F.kamarTidur,
      'Lantai': F.lantai, 'Luas Bangunan': F.luasBangunan, 'Luas Tanah': F.luasTanah,
      'Kondisi': F.kondisi, 'Notes': F.notes, 'Tipe Properti': F.tipeProperti,
      'Area/Kawasan': F.areaKawasan, 'Website Link': F.linkWebsite,
      'Listing ID': F.listingId, 'Pemilik': F.pemilik,
    };

    const mapped: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(fields)) {
      const id = nameToId[name];
      if (id) mapped[id] = value;
      else this.logger.warn(`Unknown Lark field name: ${name}`);
    }

    if (Object.keys(mapped).length > 0) {
      await this.base.updateRecord(this.tableId, recordId, mapped);
    }
  }

  async updateListingId(recordId: string, propertyId: string): Promise<void> {
    await this.base.updateRecord(this.tableId, recordId, {
      [F.listingId]: propertyId,
    });
  }

  // ── HELPERS ─────────────────────────────────────────────────────────────

  extractDisplayData(fields: Record<string, unknown>): {
    unit: string;
    namaProperti: string;
    status: string;
    tipeListing: string;
    harga: string;
    kondisi: string;
    luasBangunan: string;
    kamarTidur: string;
    lantai: string;
    jalurPemasaran: string;
    ownerName: string;
    ownerPhone: string;
    agen: string;
    mysqlPropertyId: string;
  } {
    return {
      unit: String(fields['Unit'] ?? ''),
      namaProperti: String(fields['Nama Properti'] ?? ''),
      status: String(fields['Status'] ?? ''),
      tipeListing: String(fields['Tipe Listing'] ?? ''),
      harga: String(fields['Harga Jual'] ?? fields['Harga Sewa'] ?? ''),
      kondisi: String(fields['Kondisi'] ?? ''),
      luasBangunan: String(fields['Luas Bangunan'] ?? ''),
      kamarTidur: String(fields['Kamar Tidur'] ?? ''),
      lantai: String(fields['Lantai'] ?? ''),
      jalurPemasaran: String(fields['Jalur Pemasaran'] ?? ''),
      ownerName: this.extractLinkedText(fields['Pemilik']),
      ownerPhone: '',
      agen: this.extractPersonName(fields['Agen']),
      mysqlPropertyId: String(fields['Listing ID'] ?? ''),
    };
  }

  private extractPersonName(val: unknown): string {
    if (!Array.isArray(val) || val.length === 0) return '-';
    return (val as Array<Record<string, string>>)
      .map((a) => a.name ?? a.en_name ?? '?')
      .join(', ');
  }

  private extractLinkedText(val: unknown): string {
    if (!Array.isArray(val) || val.length === 0) return '-';
    const first = val[0] as Record<string, unknown>;
    if (first.text) return String(first.text);
    if (Array.isArray(first.text_arr) && first.text_arr.length > 0) return String(first.text_arr[0]);
    return '-';
  }
}
