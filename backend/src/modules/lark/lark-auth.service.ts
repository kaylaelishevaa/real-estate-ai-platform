import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class LarkAuthService {
  private readonly logger = new Logger(LarkAuthService.name);
  private readonly appId: string;
  private readonly appSecret: string;

  private token = '';
  private expiresAt = 0; // epoch ms

  constructor(private readonly config: ConfigService) {
    this.appId = config.get<string>('CRM_APP_ID') ?? '';
    this.appSecret = config.get<string>('CRM_APP_SECRET') ?? '';
  }

  /** Returns a valid tenant_access_token, refreshing if needed. */
  async getToken(): Promise<string> {
    // Refresh if less than 10 minutes remaining
    if (this.token && Date.now() < this.expiresAt - 600_000) {
      return this.token;
    }
    return this.refresh();
  }

  private async refresh(): Promise<string> {
    const { data } = await axios.post(
      'https://api.crm-provider.example.com/auth/v3/tenant_access_token/internal',
      { app_id: this.appId, app_secret: this.appSecret },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 },
    );

    if (data.code !== 0) {
      this.logger.error(`Lark token refresh failed: ${JSON.stringify(data)}`);
      throw new Error(`Lark auth error: ${data.msg}`);
    }

    this.token = data.tenant_access_token;
    this.expiresAt = Date.now() + data.expire * 1000;
    this.logger.log(`Lark token refreshed, expires in ${data.expire}s`);
    return this.token;
  }
}
