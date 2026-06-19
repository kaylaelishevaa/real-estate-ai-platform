import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private client: AxiosInstance;
  private phoneNumberId: string;
  private accessToken: string;

  constructor(private config: ConfigService) {
    this.phoneNumberId = this.config.get('WA_PHONE_NUMBER_ID', '');
    this.accessToken = this.config.get('WA_ACCESS_TOKEN', '');

    this.client = axios.create({
      baseURL: `https://graph.facebook.com/v21.0/${this.phoneNumberId}`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  get isEnabled(): boolean {
    return (
      this.config.get('WA_ENABLED') === 'true' && !!this.accessToken
    );
  }

  /** Send a text reply to a WhatsApp user. */
  async sendText(to: string, text: string): Promise<boolean> {
    if (!this.isEnabled) {
      this.logger.warn('WhatsApp disabled, skipping send');
      return false;
    }
    try {
      await this.client.post('/messages', {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      });
      return true;
    } catch (err: any) {
      this.logger.error(
        `Failed to send WhatsApp to ${to}:`,
        err.response?.data || err.message,
      );
      return false;
    }
  }

  /** Send a template message (for confirmations, notifications). */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: any[],
  ): Promise<boolean> {
    if (!this.isEnabled) return false;
    try {
      await this.client.post('/messages', {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: components || [],
        },
      });
      return true;
    } catch (err: any) {
      this.logger.error(
        `Failed to send template to ${to}:`,
        err.response?.data || err.message,
      );
      return false;
    }
  }

  /** Mark a message as read. */
  async markAsRead(messageId: string): Promise<void> {
    if (!this.isEnabled) return;
    try {
      await this.client.post('/messages', {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch (_) {
      // Silently ignore — marking as read is best-effort
    }
  }

  /**
   * Download media from WhatsApp (images, documents).
   * WhatsApp media URLs require the access token to download.
   */
  async downloadMedia(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      // Step 1: Get the media URL
      const metaRes = await axios.get(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );
      const mediaUrl = metaRes.data.url;
      const mimeType = metaRes.data.mime_type;

      // Step 2: Download the actual file
      const fileRes = await axios.get(mediaUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        responseType: 'arraybuffer',
      });

      return { buffer: Buffer.from(fileRes.data), mimeType };
    } catch (err: any) {
      this.logger.error(
        `Failed to download media ${mediaId}:`,
        err.message,
      );
      return null;
    }
  }
}
