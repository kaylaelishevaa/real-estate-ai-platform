import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MODEL_MAP, PolymorphicService } from './polymorphic.service';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, PaginatedResult } from '../utils/pagination.helper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LISTING_TYPE = 'App\\Models\\Listing';

/** Maps sort query-param values to Prisma field names on the Listing model. */
const SORT_FIELD_MAP: Record<string, string> = {
  price: 'price',
  created_at: 'createdAt',
  published_at: 'publishedAt',
  featured: 'isFeatured',
};

// ---------------------------------------------------------------------------
// Public filter interface (used by feature services)
// ---------------------------------------------------------------------------

export interface ListingFilters {
  /** Transaction type: SELL | RENT */
  category?: string;
  /** Minimum price (as string to avoid BigInt serialisation issues). */
  minPrice?: string;
  /** Maximum price (as string). */
  maxPrice?: string;
  isFeatured?: boolean;
  /** Listing ID to exclude from results. */
  exclude?: number;
  /** Sort field key – see SORT_FIELD_MAP. */
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  /**
   * Pre-filtered property IDs (from the property-detail table).
   * Callers filter property-specific columns (bedrooms, land_area, …) first,
   * then pass the matched IDs here.
   */
  propertyIds?: number[];
}

// ---------------------------------------------------------------------------

@Injectable()
export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly polymorphic: PolymorphicService,
  ) {}

  // ── 1. Single listing with all related data ────────────────────────────────

  /**
   * Resolves a listing by ID with every piece of related data:
   * listingable, translations, media, location (→ parent), user (→ profile),
   * owner contact, agent contact.
   * Returns null when the listing does not exist.
   *
   * @param options.includeContactDetails  When true, returns full contact objects
   *   (admin use only). When false (default), strips PII (phone, email) from
   *   contacts so the public API never leaks owner/agent personal data.
   */
  async getFullListing(
    listingId: number | bigint,
    options?: { includeContactDetails?: boolean },
  ): Promise<Record<string, unknown> | null> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        location: { include: { parent: true } },
        // Only select safe user fields — never expose password publicly
        user: {
          select: {
            id: true,
            email: false,
            role: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                avatar: true,
                jobTitle: true,
              },
            },
          },
        },
      },
    });

    if (!listing) return null;

    const includeContactDetails = options?.includeContactDetails === true;

    const [listingable, translations, media, ownerContact, agentContact] =
      await Promise.all([
        this.polymorphic.resolveListingable(
          listing.listingableType,
          Number(listing.listingableId),
        ),
        this.polymorphic.resolveTranslations(LISTING_TYPE, Number(listing.id)),
        this.polymorphic.resolveMedia(LISTING_TYPE, Number(listing.id)),
        listing.ownerId
          ? this.prisma.contact.findUnique({ where: { id: listing.ownerId } })
          : Promise.resolve(null),
        listing.agentId
          ? this.prisma.contact.findUnique({ where: { id: listing.agentId } })
          : Promise.resolve(null),
      ]);

    // Strip PII from contacts for public API — only expose name for display
    const safeOwner = ownerContact
      ? (includeContactDetails
          ? ownerContact
          : { id: ownerContact.id, firstName: ownerContact.firstName, lastName: ownerContact.lastName, type: ownerContact.type })
      : null;
    const safeAgent = agentContact
      ? (includeContactDetails
          ? agentContact
          : { id: agentContact.id, firstName: agentContact.firstName, lastName: agentContact.lastName, type: agentContact.type })
      : null;

    return this.serialize({
      ...listing,
      listingable,
      translatable: translations,
      media,
      ownerContact: safeOwner,
      agentContact: safeAgent,
    });
  }

  // ── 2. Find by property_id ─────────────────────────────────────────────────

  /**
   * Find a single listing by its `property_id` field, then resolve full data.
   * Returns null when not found.
   */
  async getListingByPropertyId(
    propertyId: string,
  ): Promise<Record<string, unknown> | null> {
    const listing = await this.prisma.listing.findFirst({
      where: { propertyId },
      include: {
        location: { include: { parent: true } },
        user: {
          select: {
            id: true,
            role: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                avatar: true,
                jobTitle: true,
              },
            },
          },
        },
      },
    });

    if (!listing) return null;

    const [listingable, translations, media] = await Promise.all([
      this.polymorphic.resolveListingable(
        listing.listingableType,
        Number(listing.listingableId),
      ),
      this.polymorphic.resolveTranslations(LISTING_TYPE, Number(listing.id)),
      this.polymorphic.resolveMedia(LISTING_TYPE, Number(listing.id)),
    ]);

    return this.serialize({ ...listing, listingable, translatable: translations, media });
  }

  // ── 3. Paginated filtered list ─────────────────────────────────────────────

  /**
   * Generic paginated listing query for a given `listingableType` and set of
   * location IDs (pre-computed from a recursive CTE).
   *
   * Property-specific column filtering (bedrooms, land_area, …) is the
   * caller's responsibility: pass the resulting property IDs via
   * `filters.propertyIds`.
   */
  async getListingsByType(
    listingableType: string,
    locationIds: number[],
    filters: ListingFilters,
    page: number,
    perPage: number,
    path: string,
  ): Promise<PaginatedResult<unknown>> {
    // Short-circuit: no locations means no results
    if (!locationIds.length) return paginate([], 0, page, perPage, path);

    // Build the where clause
    const where: Prisma.ListingWhereInput = {
      listingableType,
      status: 'PUBLISHED',
      price: { gt: 0 },
      locationId: { in: locationIds },
    };

    if (filters.category) where.category = filters.category;
    if (filters.isFeatured !== undefined) where.isFeatured = filters.isFeatured;
    if (filters.exclude) where.NOT = { id: filters.exclude };
    if (filters.propertyIds?.length)
      where.listingableId = { in: filters.propertyIds };

    // Price range (BigInt filter)
    if (filters.minPrice || filters.maxPrice) {
      const priceFilter: Prisma.BigIntNullableFilter = {};
      if (filters.minPrice) priceFilter.gte = BigInt(filters.minPrice);
      if (filters.maxPrice) priceFilter.lte = BigInt(filters.maxPrice);
      where.price = priceFilter;
    }

    // Order-by
    const sortKey = filters.sortField
      ? (SORT_FIELD_MAP[filters.sortField] ?? 'createdAt')
      : 'createdAt';
    const orderBy: Prisma.ListingOrderByWithRelationInput[] = [
      { soldAt: { sort: 'asc', nulls: 'first' } },
      { isFeatured: 'desc' },
      { [sortKey]: filters.sortDirection ?? 'desc' },
    ];

    // Count total and available (not sold) separately
    const [listings, total, totalAvailable] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: {
          location: {
            select: {
              id: true,
              name: true,
              slug: true,
              parent: { select: { name: true, slug: true } },
            },
          },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy,
      }),
      this.prisma.listing.count({ where }),
      this.prisma.listing.count({ where: { ...where, soldAt: null } }),
    ]);

    if (!listings.length) {
      const result = paginate([], total, page, perPage, path);
      result.attributes = { total_available: 0 };
      return result;
    }

    // ── Batch-fetch listingables, translations, and media in parallel ────────
    const listingIds = listings.map((l) => l.id);
    const propertyIds = [...new Set(listings.map((l) => l.listingableId))];
    const delegateName = MODEL_MAP[listingableType];

    const listingablePromise = (async () => {
      if (!delegateName) return {};
      const delegate = (this.prisma as unknown as Record<string, any>)[delegateName];
      if (!delegate || typeof delegate.findMany !== 'function') return {};
      const rows = (await delegate.findMany({
        where: { id: { in: propertyIds } },
      })) as Array<{ id: bigint; [k: string]: unknown }>;
      return Object.fromEntries(rows.map((r) => [Number(r.id), r]));
    })();

    const [listingableMap, allTrans, allMedia] = await Promise.all([
      listingablePromise,
      this.prisma.translation.findMany({
        where: { translatableType: LISTING_TYPE, translatableId: { in: listingIds } },
      }),
      this.prisma.media.findMany({
        where: { mediableType: LISTING_TYPE, mediableId: { in: listingIds } },
        orderBy: { ordinal: 'asc' },
      }),
    ]);

    const transById = allTrans.reduce<Record<number, typeof allTrans>>(
      (acc, t) => {
        (acc[Number(t.translatableId)] ??= []).push(t);
        return acc;
      },
      {},
    );
    const mediaById = allMedia.reduce<Record<number, typeof allMedia>>(
      (acc, m) => {
        (acc[Number(m.mediableId)] ??= []).push(m);
        return acc;
      },
      {},
    );

    const data = listings.map((l) => {
      return this.serialize({
        ...l,
        listingable: listingableMap[Number(l.listingableId)] ?? null,
        translatable: transById[Number(l.id)] ?? [],
        media: mediaById[Number(l.id)] ?? [],
      });
    });

    const result = paginate(data, total, page, perPage, path);
    result.attributes = { total_available: totalAvailable };
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Convert BigInt fields (price, pricePerSqm) to strings so the response
   * can be serialised by Fastify's fast-json-stringify.
   */
  /**
   * Convert BigInt fields (price, pricePerSqm) to strings so the response
   * can be serialised to JSON. Snake_case key conversion is handled by the
   * global SnakeCaseInterceptor.
   */
  serialize(obj: Record<string, unknown>): Record<string, unknown> {
    const out = { ...obj };
    out.price =
      typeof out.price === 'bigint' ? Number(out.price) : (out.price ?? 0);
    out.pricePerSqm =
      typeof out.pricePerSqm === 'bigint'
        ? Number(out.pricePerSqm)
        : (out.pricePerSqm ?? 0);
    return out;
  }
}
