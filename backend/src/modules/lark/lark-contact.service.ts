import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LarkBaseService } from './lark-base.service';

// ── CRM Contacts table field IDs ─────────────────────────────────────────

const F = {
  idKontak: 'fld_contact_id',
  nama: 'fld_name',
  noHp: 'fld_phone',
  tipeKlien: 'fld_client_type',
  sumberKlien: 'fld_client_source',
  catatan: 'fld_notes',
  agen: 'fld_agent',
} as const;

export interface LarkContactInput {
  name: string;
  phone: string; // +62 format
  clientType: string[]; // e.g. ["Owner"]
  agentLarkId: string;
  notes?: string;
}

@Injectable()
export class LarkContactService {
  private readonly logger = new Logger(LarkContactService.name);
  private readonly tableId: string;

  constructor(
    private readonly base: LarkBaseService,
    private readonly config: ConfigService,
  ) {
    this.tableId = config.get<string>('CRM_CONTACTS_TABLE') ?? '';
  }

  /** Search contacts by phone number (strip prefix, compare digits). */
  async searchByPhone(
    phone: string,
  ): Promise<{ record_id: string; fields: Record<string, unknown> } | null> {
    const digits = phone.replace(/^\+?0?62/, '').replace(/^0/, '');
    const filter = `CurrentValue.[No HP].contains("${digits}")`;
    const result = await this.base.searchRecords(this.tableId, filter, 5);
    if (result.items.length === 0) return null;

    for (const item of result.items) {
      const hp = String(item.fields[F.noHp] ?? '');
      const hpDigits = hp.replace(/^\+?0?62/, '').replace(/^0/, '');
      if (hpDigits === digits) return item;
    }
    return result.items[0];
  }

  /** Create a new contact record. Returns the record_id. */
  async createContact(input: LarkContactInput): Promise<string> {
    const contactId = await this.generateContactId(input.name);

    const fields: Record<string, unknown> = {
      [F.idKontak]: contactId,
      [F.nama]: input.name,
      [F.noHp]: input.phone,
      [F.tipeKlien]: input.clientType,
      [F.sumberKlien]: 'WhatsApp',
      [F.agen]: [{ id: input.agentLarkId }],
    };
    if (input.notes) fields[F.catatan] = input.notes;

    const record = await this.base.createRecord(this.tableId, fields);
    this.logger.log(`Lark contact created: ${record.record_id} (${contactId})`);
    return record.record_id;
  }

  /**
   * Generate the next CT-XXXXX ID by querying existing records.
   * Format: "CT-XXXXX Name"
   */
  private async generateContactId(name: string): Promise<string> {
    const result = await this.base.searchRecords(
      this.tableId,
      'CurrentValue.[ID Kontak].contains("CT-")',
      100,
    );

    let maxNum = 0;
    for (const item of result.items) {
      const id = String(item.fields[F.idKontak] ?? '');
      const match = id.match(/^CT-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    const nextNum = String(maxNum + 1).padStart(5, '0');
    return `CT-${nextNum} ${name}`;
  }
}
