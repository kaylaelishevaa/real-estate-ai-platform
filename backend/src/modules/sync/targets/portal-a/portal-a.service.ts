import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import type {
  HouzezProperty,
  WordPressCreatedPost,
} from './portal-a.mapper';

// ---------------------------------------------------------------------------

/**
 * HTTP client for the Portal A WordPress REST API (Houzez theme).
 *
 * Env vars required:
 *   PORTAL_A_BASE_URL  — e.g. https://portal-a.example.com/
 *   PORTAL_A_USERNAME  — WordPress login username (not app password label)
 *   PORTAL_A_PASSWORD  — WordPress application password
 *
 * Auth: HTTP Basic with WordPress Application Passwords (WP >= 5.6).
 */
@Injectable()
export class PortalAService {
  private readonly logger = new Logger(PortalAService.name);
  private readonly client: AxiosInstance;
  readonly defaultAgentId: number | null;

  /** In-memory cache for taxonomy term IDs and agent lookups. */
  private readonly taxonomyCache = new Map<string, number>();

  constructor(private readonly config: ConfigService) {
    this.defaultAgentId =
      Number(config.get<string>('PORTAL_A_DEFAULT_AGENT_ID')) || null;
    const baseUrl = (
      config.get<string>('PORTAL_A_BASE_URL') ?? ''
    ).replace(/\/$/, '');
    const username = config.get<string>('PORTAL_A_USERNAME') ?? '';
    const password = config.get<string>('PORTAL_A_PASSWORD') ?? '';

    // WordPress Application Password format: base64("username:app_password")
    const token = Buffer.from(`${username}:${password}`).toString('base64');

    this.client = axios.create({
      baseURL: `${baseUrl}/wp-json/wp/v2`,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30_000, // 30 s — WP can be slow on shared hosting
    });
  }

  // ── POST /wp-json/wp/v2/properties ──────────────────────────────────────

  /**
   * Create a new Houzez property on the WordPress site.
   * @returns The created property `{ id, link, status }`.
   */
  async createPost(listingData: HouzezProperty): Promise<WordPressCreatedPost> {
    const { data } = await this.client.post<WordPressCreatedPost>(
      '/properties',
      listingData,
    );
    this.logger.log(`WP property created — id=${data.id} link=${data.link}`);
    return data;
  }

  // ── PUT /wp-json/wp/v2/properties/{id} ──────────────────────────────────

  /**
   * Update an existing Houzez property (full update).
   * @param externalId - The WordPress post ID stored in SyncLog.externalId.
   */
  async updatePost(
    externalId: string | number,
    listingData: HouzezProperty,
  ): Promise<WordPressCreatedPost> {
    const { data } = await this.client.put<WordPressCreatedPost>(
      `/properties/${externalId}`,
      listingData,
    );
    this.logger.log(`WP property updated — id=${externalId}`);
    return data;
  }

  // ── Deactivate (set to draft) ───────────────────────────────────────────

  /**
   * Move a Houzez property to 'draft' status (soft-deactivate).
   * @param externalId - The WordPress post ID.
   */
  async deactivatePost(externalId: string | number): Promise<void> {
    await this.client.put(`/properties/${externalId}`, { status: 'draft' });
    this.logger.log(`WP property deactivated (-> draft) — id=${externalId}`);
  }

  // ── DELETE /wp-json/wp/v2/properties/{id} ──────────────────────────

  /**
   * Move a Houzez property to trash (WordPress default delete behaviour).
   * @param externalId - The WordPress post ID.
   */
  async deletePost(externalId: string | number): Promise<void> {
    await this.client.delete(`/properties/${externalId}`);
    this.logger.log(`WP property trashed — id=${externalId}`);
  }

  // ── Image upload to WP media library ────────────────────────────────────

  /**
   * Upload an image to WordPress media library by URL.
   * Downloads from our CDN, then uploads to WP.
   * @returns The WP attachment ID.
   */
  async uploadImageByUrl(imageUrl: string, title?: string): Promise<number> {
    // 1. Download image from CDN
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30_000,
    });
    const buffer = Buffer.from(imageResponse.data);

    // 2. Extract filename from URL
    const urlPath = new URL(imageUrl).pathname;
    const filename = urlPath.split('/').pop() || 'image.jpg';
    const contentType = imageResponse.headers['content-type'] || 'image/jpeg';

    // 3. Upload to WP media library
    const { data } = await this.client.post<{ id: number }>('/media', buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      // Override default JSON content-type for binary upload
      maxBodyLength: Infinity,
    });

    this.logger.log(`WP media uploaded — id=${data.id} filename=${filename}${title ? ` (${title})` : ''}`);
    return data.id;
  }

  // ── Taxonomy term management ────────────────────────────────────────────

  /**
   * Find or create a taxonomy term on the Houzez site.
   * Results are cached in-memory for the process lifetime.
   *
   * @param taxonomy - REST endpoint slug, e.g. 'property_type', 'property_area'
   * @param name     - Human-readable term name
   * @param slug     - URL-safe slug
   * @returns The term ID, or null on failure
   */
  async findOrCreateTaxonomyTerm(
    taxonomy: string,
    name: string,
    slug: string,
  ): Promise<number | null> {
    const cacheKey = `${taxonomy}:${slug}`;
    const cached = this.taxonomyCache.get(cacheKey);
    if (cached) return cached;

    try {
      // Search for existing term
      const { data: existing } = await this.client.get<Array<{ id: number; name: string }>>(
        `/${taxonomy}`,
        { params: { search: name, per_page: 5 } },
      );

      const match = existing.find(
        (t) => t.name?.toLowerCase() === name.toLowerCase(),
      );
      if (match) {
        this.taxonomyCache.set(cacheKey, match.id);
        return match.id;
      }

      // Create new term
      const { data: created } = await this.client.post<{ id: number }>(
        `/${taxonomy}`,
        { name, slug },
      );
      this.logger.log(`Created ${taxonomy} term "${name}" — id=${created.id}`);
      this.taxonomyCache.set(cacheKey, created.id);
      return created.id;
    } catch (err) {
      this.logger.warn(
        `Failed to find/create ${taxonomy} "${name}": ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ── Agent resolution ───────────────────────────────────────────────────

  /**
   * Find a Houzez agent post by email.  Falls back to a default agent.
   * Results are cached in-memory for the process lifetime.
   *
   * @returns The Houzez agent post ID (for `fave_agents` meta), or null.
   */
  async findAgentByEmail(email: string): Promise<number | null> {
    const cacheKey = `agent:${email.toLowerCase()}`;
    const cached = this.taxonomyCache.get(cacheKey);
    if (cached) return cached;

    try {
      const { data: agents } = await this.client.get<
        Array<{ id: number; agent_meta?: { fave_agent_email?: string[] } }>
      >('/agents', { params: { per_page: 100 } });

      for (const agent of agents) {
        const agentEmail =
          agent.agent_meta?.fave_agent_email?.[0]?.toLowerCase();
        if (agentEmail === email.toLowerCase()) {
          this.taxonomyCache.set(cacheKey, agent.id);
          return agent.id;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to search agents by email: ${(err as Error).message}`,
      );
    }

    return null;
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  /**
   * Verify connectivity and auth by fetching the WP user info.
   */
  async ping(): Promise<{ id: number; name: string }> {
    const { data } = await this.client.get<{ id: number; name: string }>(
      '/users/me',
    );
    return data;
  }
}
