import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import { LarkAuthService } from './lark-auth.service';

@Injectable()
export class LarkBaseService {
  private readonly logger = new Logger(LarkBaseService.name);
  private readonly baseAppToken: string;
  private readonly client: AxiosInstance;

  constructor(
    private readonly auth: LarkAuthService,
    private readonly config: ConfigService,
  ) {
    this.baseAppToken = config.get<string>('CRM_BASE_TOKEN') ?? '';
    this.client = axios.create({
      baseURL: 'https://api.crm-provider.example.com/bitable/v1',
      timeout: 15_000,
    });
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.auth.getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private tablePath(tableId: string): string {
    return `/apps/${this.baseAppToken}/tables/${tableId}/records`;
  }

  async createRecord(
    tableId: string,
    fields: Record<string, unknown>,
  ): Promise<{ record_id: string; fields: Record<string, unknown> }> {
    const { data } = await this.client.post(
      this.tablePath(tableId),
      { fields },
      { headers: await this.headers() },
    );
    if (data.code !== 0) {
      this.logger.error(`Lark createRecord failed: ${JSON.stringify(data)}`);
      throw new Error(`Lark createRecord: ${data.msg}`);
    }
    return data.data.record;
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const { data } = await this.client.put(
      `${this.tablePath(tableId)}/${recordId}`,
      { fields },
      { headers: await this.headers() },
    );
    if (data.code !== 0) {
      this.logger.error(`Lark updateRecord failed: ${JSON.stringify(data)}`);
      throw new Error(`Lark updateRecord: ${data.msg}`);
    }
  }

  async searchRecords(
    tableId: string,
    filter: string,
    pageSize = 20,
  ): Promise<{ items: Array<{ record_id: string; fields: Record<string, unknown> }>; total: number }> {
    const { data } = await this.client.get(this.tablePath(tableId), {
      headers: await this.headers(),
      params: { filter, page_size: pageSize },
    });
    if (data.code !== 0) {
      this.logger.error(`Lark searchRecords failed: ${JSON.stringify(data)}`);
      throw new Error(`Lark searchRecords: ${data.msg}`);
    }
    return {
      items: data.data.items ?? [],
      total: data.data.total ?? 0,
    };
  }

  async getRecord(
    tableId: string,
    recordId: string,
  ): Promise<{ record_id: string; fields: Record<string, unknown> }> {
    const { data } = await this.client.get(
      `${this.tablePath(tableId)}/${recordId}`,
      { headers: await this.headers() },
    );
    if (data.code !== 0) {
      throw new Error(`Lark getRecord: ${data.msg}`);
    }
    return data.data.record;
  }
}
