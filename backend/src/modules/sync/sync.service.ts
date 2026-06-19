import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { PortalAService } from './targets/portal-a/portal-a.service';
import { PortalBService } from './targets/portal-b/portal-b.service';
import { SyncLogService } from './sync-log.service';
import {
  mapListingToHouzez,
  HOUZEZ_PROPERTY_TYPE,
  HOUZEZ_PROPERTY_TYPE_CREATE,
} from './targets/portal-a/portal-a.mapper';
import type {
  SyncListing as PortalASyncListing,
  SyncTranslation as PortalASyncTranslation,
  SyncMedia as PortalASyncMedia,
  SyncListingable,
  HouzezProperty,
} from './targets/portal-a/portal-a.mapper';
import {
  mapListingToPortalB,
  PORTAL_B_UNSUPPORTED_TYPES,
} from './targets/portal-b/portal-b.mapper';
import type {
  SyncAgent,
  SyncLocation,
  SyncTranslation as PortalBSyncTranslation,
  SyncMedia as PortalBSyncMedia,
} from './targets/portal-b/portal-b.mapper';

// ---------------------------------------------------------------------------
// Exported types used by the processor and admin controller
// ---------------------------------------------------------------------------

export type SyncTarget = 'portal-a' | 'portal-b';
export type SyncAction = 'create' | 'update' | 'deactivate';

export interface SyncJobPayload {
  listingId: number | bigint;
  target: SyncTarget;
  action: SyncAction;
}

// ---------------------------------------------------------------------------

const LISTING_TYPE = 'App\\Models\\Listing';

// ---------------------------------------------------------------------------

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly syncLogService: SyncLogService,
    private readonly portalAService: PortalAService,
    private readonly portalBService: PortalBService,
    @InjectQueue('listing-sync')
    private readonly queue: Queue,
  ) {}

  // ── Public dispatch API ───────────────────────────────────────────────────

  /**
   * Enqueue sync jobs for ALL configured targets.
   * Non-blocking — actual sync happens inside the BullMQ worker.
   *
   * BullMQ retry config: 3 attempts, exponential backoff (base 1 s -> ~1 s, 2 s, 4 s).
   */
  async dispatchSync(
    listingId: bigint | number,
    action: SyncAction,
    delayMs?: number,
  ): Promise<void> {
    const targets: SyncTarget[] = ['portal-a', 'portal-b'];

    // Cancel any pending/waiting jobs for this listing to prevent race conditions
    // (e.g. publish then immediate unpublish — the 'create' job should not run)
    await this.cancelPendingJobsForListing(listingId);

    await Promise.all(
      targets.map((target) =>
        this.queue.add(
          'sync-listing',
          { listingId, target, action } satisfies SyncJobPayload,
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: 100,
            removeOnFail: false,
            ...(delayMs ? { delay: delayMs } : {}),
          },
        ),
      ),
    );

    this.logger.log(
      `Queued "${action}" jobs for listing #${listingId} -> [${targets.join(', ')}]`,
    );
  }

  /**
   * Enqueue a sync job for ONE specific target.
   * Used by the admin retry endpoint so only the failed target is retried,
   * not all targets.
   */
  async dispatchSyncForTarget(
    listingId: bigint | number,
    target: SyncTarget,
    action: SyncAction,
  ): Promise<void> {
    await this.queue.add(
      'sync-listing',
      { listingId, target, action } satisfies SyncJobPayload,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );

    this.logger.log(
      `Queued retry "${action}" job for listing #${listingId} -> ${target}`,
    );
  }

  // ── Synchronous deactivate (called before DB delete) ─────────────────────

  /**
   * Deactivate a listing on ALL external portals synchronously.
   * Called by AdminListingService.remove() before the listing is deleted
   * from the database — cannot use BullMQ because the listing would be
   * gone by the time the worker processes the job.
   */
  async deactivateBeforeDelete(listingId: number | bigint): Promise<void> {
    const targets: SyncTarget[] = ['portal-a'];

    for (const target of targets) {
      const previousLog = await this.syncLogService.getSyncStatus(
        listingId,
        target,
      );
      const externalId = previousLog?.externalId ?? null;
      if (!externalId) continue;

      try {
        if (target === 'portal-a') {
          await this.portalAService.deletePost(externalId);
        }
        this.logger.log(
          `Deactivated listing #${listingId} on ${target} (externalId=${externalId})`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to deactivate listing #${listingId} on ${target}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ── Job deduplication ────────────────────────────────────────────────────

  /**
   * Remove waiting/delayed jobs for a given listing from the queue.
   * Prevents race conditions when state transitions happen in quick succession
   * (e.g. publish -> immediate unpublish would leave a stale 'create' job).
   */
  private async cancelPendingJobsForListing(listingId: bigint | number): Promise<void> {
    try {
      const lid = Number(listingId);
      const waitingJobs = await this.queue.getJobs(['waiting', 'delayed']);
      const toRemove = waitingJobs.filter((job) => {
        const data = job.data as SyncJobPayload | undefined;
        return data && Number(data.listingId) === lid;
      });

      for (const job of toRemove) {
        await job.remove();
        this.logger.debug(`Removed stale job ${job.id} for listing #${lid}`);
      }
    } catch (err) {
      // Non-critical — log and continue
      this.logger.warn(
        `Failed to cancel pending jobs for listing #${listingId}: ${(err as Error).message}`,
      );
    }
  }

  // ── Orchestrator ──────────────────────────────────────────────────────────

  /**
   * Sync a single listing to one target.
   *
   * Steps:
   *  1. Fetch full listing data (core + listingable + translations + media + user).
   *  2. Check sync_logs for the most-recent successful entry -> get externalId.
   *  3. Create a 'pending' log entry.
   *  4. Call the target-specific sync method.
   *  5. Update the log to 'success' or 'failed'.
   *  6. Re-throw on failure so BullMQ retries according to job options.
   */
  async syncListing(
    listingId: bigint | number,
    target: SyncTarget,
    action: SyncAction,
  ): Promise<void> {
    // ── 1. Fetch ─────────────────────────────────────────────────────────────
    const data = await this.getFullListing(listingId);
    if (!data) throw new Error(`Listing #${listingId} not found`);

    // ── 2. Previous log -> externalId ─────────────────────────────────────────
    const previousLog = await this.syncLogService.getSyncStatus(
      listingId,
      target,
    );
    const externalId = previousLog?.externalId ?? null;

    // ── 3. Create pending log ─────────────────────────────────────────────────
    const log = await this.syncLogService.createLog({
      listingId,
      target,
      action,
      status: 'pending',
    });

    // ── Guard: skip Portal A sync when listing has no images ────────────
    if (target === 'portal-a' && data.media.length === 0) {
      this.logger.warn(
        `Portal A sync skipped — listing #${listingId} has no media`,
      );
      await this.syncLogService.updateLog(log.id, {
        status: 'skipped',
        errorMessage: 'Listing has no media — skipped Portal A sync',
      });
      return;
    }

    // ── 4 + 5. Dispatch & update log ──────────────────────────────────────────
    try {
      let resultExternalId: string | null = externalId;

      if (target === 'portal-a') {
        resultExternalId = await this.syncToPortalA(
          data,
          action,
          externalId,
        );
      } else if (target === 'portal-b') {
        resultExternalId = await this.syncToPortalB(data, action);
      }

      await this.syncLogService.updateLog(log.id, {
        status: 'success',
        externalId: resultExternalId,
      });

      this.logger.log(
        `Sync success — listing #${listingId} -> ${target} [${action}]`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      await this.syncLogService.updateLog(log.id, {
        status: 'failed',
        errorMessage: message,
      });

      // Re-throw so BullMQ retries the job (up to `attempts` in job options).
      throw err;
    }
  }

  // ── Target: Portal A ─────────────────────────────────────────────────

  private async syncToPortalA(
    data: FullListingData,
    action: SyncAction,
    externalId: string | null,
  ): Promise<string | null> {
    const { row, listingable, translations, media } = data;

    // ── Resolve location (fall back to apartment/office building location) ──
    let resolvedLocation = row.location;
    let areaNameOverride: string | null = null;

    if (!resolvedLocation) {
      if (row.listingableType === 'App\\Models\\ApartmentUnit' && listingable) {
        const unit = await this.prisma.apartmentUnit.findUnique({
          where: { id: row.listingableId },
          include: {
            apartment: {
              include: {
                location: { include: { parent: { include: { parent: true } } } },
              },
            },
          },
        });
        if (unit?.apartment?.location) {
          resolvedLocation = unit.apartment.location as unknown as typeof resolvedLocation;
          areaNameOverride = unit.apartment.title ?? null;
        }
      } else if (row.listingableType === 'App\\Models\\Office' && listingable) {
        const office = await this.prisma.office.findUnique({
          where: { id: row.listingableId },
          include: {
            officeBuilding: {
              include: {
                location: { include: { parent: { include: { parent: true } } } },
              },
            },
          },
        });
        if ((office?.officeBuilding as any)?.location) {
          resolvedLocation = (office!.officeBuilding as any).location as typeof resolvedLocation;
          areaNameOverride = (office!.officeBuilding as any).title ?? null;
        }
      }
    } else if (row.listingableType === 'App\\Models\\ApartmentUnit') {
      // Even with location, use apartment title as area name
      const unit = await this.prisma.apartmentUnit.findUnique({
        where: { id: row.listingableId },
        include: { apartment: true },
      });
      if (unit?.apartment?.title) {
        areaNameOverride = unit.apartment.title;
      }
    }

    // Build the Portal A-specific SyncListing with the resolved location
    const syncListing: PortalASyncListing = {
      id: row.id,
      listingableType: row.listingableType,
      listingableId: row.listingableId,
      propertyId: row.propertyId,
      category: row.category,
      status: row.status,
      type: row.type,
      isFeatured: row.isFeatured,
      address: row.address,
      addressGmaps: row.addressGmaps,
      addressNotes: row.addressNotes,
      longitude: row.longitude,
      latitude: row.latitude,
      price: row.price != null ? String(row.price) : null,
      pricePerSqm: row.pricePerSqm != null ? String(row.pricePerSqm) : null,
      youtubeEmbed: row.youtubeEmbed,
      publishedAt: row.publishedAt,
      soldAt: (row as any).soldAt ?? null,
      location: resolvedLocation
        ? {
            id: resolvedLocation.id,
            name: resolvedLocation.name,
            slug: resolvedLocation.slug,
            parent: resolvedLocation.parent
              ? {
                  name: resolvedLocation.parent.name,
                  slug: resolvedLocation.parent.slug,
                  parent: resolvedLocation.parent.parent
                    ? {
                        name: resolvedLocation.parent.parent.name,
                        slug: resolvedLocation.parent.parent.slug,
                      }
                    : null,
                }
              : null,
          }
        : null,
    };

    // Deactivate: move property to draft
    if (action === 'deactivate') {
      if (!externalId) {
        this.logger.warn(
          `Portal A deactivate skipped — no externalId for listing #${row.id}`,
        );
        return null;
      }
      await this.portalAService.deactivatePost(externalId);
      return externalId;
    }

    // ── Upload images to WP media library ─────────────────────────────────
    const galleryMedia = media
      .filter((m) => !m.mediableGroup || m.mediableGroup === 'gallery' || m.mediableGroup === 'default')
      .sort((a, b) => (a.ordinal ?? 999) - (b.ordinal ?? 999));

    const wpMediaIds: number[] = [];
    this.logger.log(`Attempting to upload ${galleryMedia.length} images for listing #${row.id}`);
    for (const m of galleryMedia.slice(0, 10)) { // Limit to 10 images
      this.logger.log(`Uploading image: ${m.url}`);
      try {
        const wpId = await this.portalAService.uploadImageByUrl(
          m.url,
          `listing-${row.propertyId}`,
        );
        this.logger.log(`Image uploaded successfully: WP attachment ID = ${wpId}`);
        wpMediaIds.push(wpId);
      } catch (err) {
        this.logger.error(`Image upload FAILED for ${m.url}: ${(err as Error).message}`);
        this.logger.error(err);
      }
    }
    this.logger.log(`Total images uploaded: ${wpMediaIds.length} / ${galleryMedia.length}`);

    // ── Map listing to Houzez property payload ────────────────────────────
    const payload: HouzezProperty = mapListingToHouzez(
      syncListing,
      listingable as SyncListingable,
      translations as PortalASyncTranslation[],
      media as PortalASyncMedia[],
    );

    // ── Auto-generate content if empty ────────────────────────────────────
    if (!payload.content || payload.content === '<p></p>') {
      const parts: string[] = [];
      const category = row.category === 'RENT' ? 'Disewakan' : 'Dijual';
      parts.push(`${category} ${payload.title}.`);
      const bed = payload.meta['fave_property_bedrooms'];
      const bath = payload.meta['fave_property_bathrooms'];
      const size = payload.meta['fave_property_size'];
      const land = payload.meta['fave_property_land'];
      const specs: string[] = [];
      if (bed && bed !== '0') specs.push(`${bed} kamar tidur`);
      if (bath && bath !== '0') specs.push(`${bath} kamar mandi`);
      if (size && size !== '0' && size !== '') specs.push(`luas bangunan ${size} m\u00B2`);
      if (land && land !== '0' && land !== '') specs.push(`luas tanah ${land} m\u00B2`);
      if (specs.length > 0) parts.push(`Unit ini terdiri dari ${specs.join(', ')}.`);
      if (row.address) parts.push(`Berlokasi di ${row.address}.`);
      const price = payload.meta['fave_property_price'];
      if (price && price !== '0') {
        const formatted = Number(price).toLocaleString('id-ID');
        parts.push(`Harga: Rp ${formatted}.`);
      }
      payload.content = `<p>${parts.join(' ')}</p>`;
    }

    // ── Set image meta (attachment IDs, not URLs) ─────────────────────────
    if (wpMediaIds.length > 0) {
      payload.meta['_thumbnail_id'] = wpMediaIds[0];
      payload.meta['fave_property_images'] = wpMediaIds.map(String);
      payload.featured_media = wpMediaIds[0];
    }

    // ── Handle missing property_type taxonomy terms ───────────────────────
    const typeKey = `${row.listingableType}_${row.category}`;
    if (
      HOUZEZ_PROPERTY_TYPE[typeKey] === 0 &&
      HOUZEZ_PROPERTY_TYPE_CREATE[typeKey]
    ) {
      const { name, slug } = HOUZEZ_PROPERTY_TYPE_CREATE[typeKey];
      const termId = await this.portalAService.findOrCreateTaxonomyTerm(
        'property_type',
        name,
        slug,
      );
      if (termId) {
        payload.property_type = [termId];
        // Update the in-memory map so subsequent syncs use the cached ID
        HOUZEZ_PROPERTY_TYPE[typeKey] = termId;
      }
    }

    // ── Resolve Houzez agent (required for search/archive visibility) ───
    let houzezAgentId: number | null = null;
    if (row.user?.email) {
      houzezAgentId = await this.portalAService.findAgentByEmail(row.user.email);
    }
    if (!houzezAgentId) {
      houzezAgentId = this.portalAService.defaultAgentId;
    }
    if (houzezAgentId) {
      payload.meta['fave_agents'] = String(houzezAgentId);
    }
    payload.meta['_houzez_expiration_date_status'] = 'saved';

    // ── Resolve property_area from apartment/building title or location name ─
    if (areaNameOverride || resolvedLocation) {
      const areaName = areaNameOverride || resolvedLocation!.name;
      const areaSlug = areaName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      const areaId = await this.portalAService.findOrCreateTaxonomyTerm(
        'property_area',
        areaName,
        areaSlug,
      );
      if (areaId) {
        payload.property_area = [areaId];
      }
    }

    if (action === 'update' && externalId) {
      const result = await this.portalAService.updatePost(externalId, payload);
      return String(result.id);
    }

    // create (also fallback when action = 'update' but externalId is missing)
    const result = await this.portalAService.createPost(payload);
    return String(result.id);
  }

  // ── Target: Portal B ──────────────────────────────────────────────────────

  private async syncToPortalB(
    data: FullListingData,
    action: SyncAction,
  ): Promise<string | null> {
    const { row, listingable, translations, media } = data;

    // Portal B integration API has no deactivate / delete endpoint
    if (action === 'deactivate') {
      this.logger.warn(
        `Portal B deactivate is not supported — skipping listing #${row.id}`,
      );
      return null;
    }

    // Guard: types not supported by Portal B (Hotel, Business, NewProjectUnit)
    if (PORTAL_B_UNSUPPORTED_TYPES.has(row.listingableType)) {
      this.logger.warn(
        `Portal B does not support type "${row.listingableType}" — skipping listing #${row.id}`,
      );
      return null;
    }

    // Agent block is required by Portal B
    if (!data.row.user) {
      throw new Error(
        `Listing #${row.id} has no associated user — cannot build Portal B agent block`,
      );
    }

    const user = data.row.user;

    // Validate agent email format before syncing
    if (!user.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
      throw new Error(
        `Listing #${row.id} agent email "${user.email}" is invalid — Portal B requires a valid email`,
      );
    }

    const agent: SyncAgent = {
      name:
        `${user.profile?.firstName ?? ''} ${user.profile?.lastName ?? ''}`.trim() ||
        user.email,
      email: user.email,
      mobilePhone: user.profile?.phone ?? '',
    };

    // Build a 3-level SyncLocation (district -> city -> province)
    const syncLocation: SyncLocation | null = row.location
      ? {
          id: row.location.id,
          name: row.location.name,
          slug: row.location.slug,
          parent: row.location.parent
            ? {
                name: row.location.parent.name,
                slug: row.location.parent.slug,
                parent: row.location.parent.parent
                  ? {
                      name: row.location.parent.parent.name,
                      slug: row.location.parent.parent.slug,
                    }
                  : null,
              }
            : null,
        }
      : null;

    // Build a plain SyncListing for the Portal B mapper (no embedded location)
    const syncListing = {
      id: row.id,
      listingableType: row.listingableType,
      listingableId: row.listingableId,
      propertyId: row.propertyId,
      category: row.category,
      status: row.status,
      type: row.type,
      isFeatured: row.isFeatured,
      address: row.address,
      addressGmaps: row.addressGmaps,
      addressNotes: row.addressNotes,
      longitude: row.longitude,
      latitude: row.latitude,
      price: row.price != null ? String(row.price) : null,
      pricePerSqm: row.pricePerSqm != null ? String(row.pricePerSqm) : null,
      youtubeEmbed: row.youtubeEmbed,
      publishedAt: row.publishedAt,
    };

    // Validate area fields and cache location data in Redis
    if (listingable) {
      const landArea = Number(listingable['landArea'] ?? 0);
      const buildingArea = Number(listingable['buildingArea'] ?? 0);
      if (landArea < 0 || buildingArea < 0) {
        throw new Error(
          `Listing #${row.id} has invalid area values — landArea=${landArea}, buildingArea=${buildingArea}`,
        );
      }
      if (buildingArea > 0 && landArea > 0 && buildingArea > landArea * 10) {
        this.logger.warn(
          `Listing #${row.id}: buildingArea (${buildingArea}) is >10x landArea (${landArea}) — verify data`,
        );
      }
    }

    // Cache location hierarchy in Redis to reduce repeated DB lookups
    if (syncLocation) {
      const cacheKey = `portal-b:location:${row.locationId}`;
      const cached = await this.cacheService.get<SyncLocation>(cacheKey);
      if (!cached) {
        await this.cacheService.set(cacheKey, syncLocation, 3600); // 1h TTL
      }
    }

    const payload = mapListingToPortalB(
      syncListing,
      listingable as SyncListingable,
      translations as PortalBSyncTranslation[],
      media as PortalBSyncMedia[],
      agent,
      syncLocation,
    );

    const response = await this.portalBService.uploadListing(payload);

    // Portal B uses our own listing_id as the upsert key;
    // store the listing_id they echo back (falls back to our propertyId).
    return response.listing_id ?? row.propertyId ?? String(row.id);
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  /**
   * Fetch every piece of data required by any sync target in one pass.
   * Returns `null` when the listing does not exist.
   */
  private async getFullListing(
    listingId: bigint | number,
  ): Promise<FullListingData | null> {
    const row = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        location: {
          include: {
            parent: { include: { parent: true } },
          },
        },
        user: { include: { profile: true } },
      },
    });

    if (!row) return null;

    const [rawTranslations, rawMedia] = await Promise.all([
      this.prisma.translation.findMany({
        where: { translatableType: LISTING_TYPE, translatableId: listingId },
      }),
      this.prisma.media.findMany({
        where: { mediableType: LISTING_TYPE, mediableId: listingId },
        orderBy: { ordinal: 'asc' },
      }),
    ]);

    const listingable = await this.fetchListingable(
      row.listingableType,
      row.listingableId,
    );

    // Normalize translation shape
    const translations = rawTranslations.map((t) => ({
      id: t.id,
      lang: t.lang,
      title: t.title,
      slug: t.slug,
      shortDescription: t.shortDescription,
      content: t.content,
    }));

    // Normalize media shape
    const media = rawMedia.map((m) => ({
      id: m.id,
      url: m.url,
      ordinal: m.ordinal,
      mediableGroup: m.mediableGroup,
    }));

    return { row, listingable, translations, media };
  }

  /** Dynamically resolve the polymorphic listingable record by type string. */
  private async fetchListingable(
    type: string,
    id: bigint,
  ): Promise<Record<string, unknown> | null> {
    switch (type) {
      case 'App\\Models\\House':
        return this.prisma.house.findUnique({
          where: { id },
        }) as Promise<Record<string, unknown> | null>;
      case 'App\\Models\\ApartmentUnit':
        return this.prisma.apartmentUnit.findUnique({
          where: { id },
        }) as Promise<Record<string, unknown> | null>;
      case 'App\\Models\\Land':
        return this.prisma.land.findUnique({ where: { id } }) as Promise<Record<
          string,
          unknown
        > | null>;
      case 'App\\Models\\Shop':
        return this.prisma.shop.findUnique({ where: { id } }) as Promise<Record<
          string,
          unknown
        > | null>;
      case 'App\\Models\\Warehouse':
        return this.prisma.warehouse.findUnique({
          where: { id },
        }) as Promise<Record<string, unknown> | null>;
      case 'App\\Models\\Hotel':
        return this.prisma.hotel.findUnique({
          where: { id },
        }) as Promise<Record<string, unknown> | null>;
      case 'App\\Models\\Business':
        return this.prisma.business.findUnique({
          where: { id },
        }) as Promise<Record<string, unknown> | null>;
      case 'App\\Models\\Office':
        return this.prisma.office.findUnique({
          where: { id },
        }) as Promise<Record<string, unknown> | null>;
      case 'App\\Models\\NewProjectUnit':
        return this.prisma.newProjectUnit.findUnique({
          where: { id },
        }) as Promise<Record<string, unknown> | null>;
      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal types (not exported — callers use SyncService's public methods)
// ---------------------------------------------------------------------------

/**
 * Raw Prisma row shape returned by `getFullListing`.
 * The `row` field carries the full Prisma type (including BigInt price fields)
 * so each target method can cast/stringify as needed.
 */
type PrismaListing = Awaited<
  ReturnType<PrismaService['listing']['findUnique']>
> & {
  location: {
    id: bigint;
    name: string;
    slug: string;
    parent: {
      id: bigint;
      name: string;
      slug: string;
      parent: { id: bigint; name: string; slug: string } | null;
    } | null;
  } | null;
  user: {
    id: bigint;
    email: string;
    profile: {
      firstName: string;
      lastName: string;
      phone: string | null;
    } | null;
  } | null;
};

interface FullListingData {
  row: NonNullable<PrismaListing>;
  listingable: Record<string, unknown> | null;
  translations: Array<{
    id: bigint;
    lang: string | null;
    title: string | null;
    slug: string | null;
    shortDescription: string | null;
    content: string | null;
  }>;
  media: Array<{
    id: bigint;
    url: string;
    ordinal: number | null;
    mediableGroup: string;
  }>;
}
