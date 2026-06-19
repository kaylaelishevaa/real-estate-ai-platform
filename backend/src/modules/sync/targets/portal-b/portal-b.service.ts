import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import type {
  PortalBPayload,
  PortalBUploadResponse,
} from './portal-b.mapper';

// ---------------------------------------------------------------------------

/**
 * HTTP client for the Portal B Listing Integration API.
 *
 * Env vars required:
 *   PORTAL_B_API_URL    — Base URL, e.g. https://api.portal-b.example.com
 *   PORTAL_B_CLIENT_KEY — Client key issued by Portal B (sent as query param)
 *
 * Auth: client_key appended as a query parameter on every request.
 * There is no per-request token; the client_key IS the credential.
 */
@Injectable()
export class PortalBService {
  private readonly logger = new Logger(PortalBService.name);
  private readonly client: AxiosInstance;
  private readonly clientKey: string;

  constructor(private readonly config: ConfigService) {
    const baseUrl = (config.get<string>('PORTAL_B_API_URL') ?? '').replace(
      /\/$/,
      '',
    );
    this.clientKey = config.get<string>('PORTAL_B_CLIENT_KEY') ?? '';

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30_000,
    });
  }

  // ── POST /v1/listing/upload/body/json ───────────���─────────────────────────

  /**
   * Upload (create **or** update) a listing on Portal B.
   *
   * The endpoint is upsert-based: both create and update use the same URL,
   * keyed on `listing.listing_id` (our internal property ID).
   *
   * @param data - The mapped Portal B payload `{ agent, listing }`.
   * @returns The Portal B API response `{ status, listing_id?, message? }`.
   */
  async uploadListing(data: PortalBPayload): Promise<PortalBUploadResponse> {
    const { data: response } = await this.client.post<PortalBUploadResponse>(
      '/v1/listing/upload/body/json',
      data,
      { params: { client_key: this.clientKey } },
    );

    this.logger.log(
      `Portal B listing uploaded — listing_id=${data.listing.listing_id} status=${response.status}`,
    );

    return response;
  }

  // ── Utility ────────────────────────────────────────────────────��──────────

  /**
   * Verify API connectivity by performing a lightweight probe request.
   * Useful as a health-check before starting a bulk sync.
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.get('/v1/listing', {
        params: { client_key: this.clientKey },
      });
      return true;
    } catch {
      return false;
    }
  }
}
