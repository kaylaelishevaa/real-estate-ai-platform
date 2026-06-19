import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';

/**
 * Sends messages via CRM Provider Omnichannel API.
 * Used for replying within an active WhatsApp conversation (room).
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  private readonly enabled: boolean;
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<string>('CRM_PROVIDER_ENABLED') === 'true';

    const baseUrl = (config.get<string>('CRM_PROVIDER_API_URL') ?? '').replace(/\/$/, '');
    const token = config.get<string>('CRM_PROVIDER_API_TOKEN') ?? '';

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 10_000,
    });

    if (!this.enabled) {
      this.logger.warn('CRM Provider messaging is DISABLED');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Send a text reply in an existing CRM Provider room. */
  async sendText(roomId: string, text: string): Promise<boolean> {
    if (!this.enabled) {
      this.logger.debug('CRM Provider disabled — skipping sendText');
      return false;
    }
    try {
      await this.client.post('/api/open/v1/messages/whatsapp', {
        room_id: roomId,
        type: 'text',
        text,
      });
      return true;
    } catch (err: any) {
      this.logger.error(
        `Failed to send message to room ${roomId}:`,
        err.response?.data || err.message,
      );
      return false;
    }
  }

  /** Download media from a URL provided in the webhook payload. */
  async downloadMedia(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30_000,
      });
      const mimeType = response.headers['content-type'] || 'image/jpeg';
      return { buffer: Buffer.from(response.data), mimeType };
    } catch (err: any) {
      this.logger.error(`Failed to download media from ${url}: ${err.message}`);
      return null;
    }
  }

  /**
   * Register the webhook URL with CRM Provider (one-time or on startup).
   * PUT /api/open/v1/message_interactions
   */
  async registerWebhook(): Promise<boolean> {
    if (!this.enabled) return false;
    const webhookUrl = this.config.get<string>('CRM_PROVIDER_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn('CRM_PROVIDER_WEBHOOK_URL not set — skipping webhook registration');
      return false;
    }

    try {
      await this.client.put('/api/open/v1/message_interactions', {
        receive_message_from_customer: true,
        receive_message_from_agent: false,
        broadcast_log_status: false,
        status_message: false,
        url: webhookUrl,
      });
      this.logger.log(`CRM Provider webhook registered: ${webhookUrl}`);
      return true;
    } catch (err: any) {
      this.logger.error(
        'CRM Provider webhook registration failed:',
        err.response?.data || err.message,
      );
      return false;
    }
  }
}
