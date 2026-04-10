import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../../common/services/cache.service';
import { PolymorphicService } from '../../common/services/polymorphic.service';
import { paginate, paginateQuery } from '../../common/utils/pagination.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchLocationDto } from './dto/search-location.dto';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const LOCATION_TYPE = 'App\\Models\\Location';
const LISTING_TYPE = 'App\\Models\\Listing';

/**
 * Property types whose records have a direct `title` + `slug` field,
 * mapped to their Prisma delegate name.
 */
const TITLED_PROPERTY_MAP: Record<string, string> = {
  apartment: 'apartment',
  office: 'officeBuilding',
  'new-project': 'newProject',
};

/**
 * Listing-based property types that don't have their own title column –
 * autocomplete searches their listing translations instead.
 */
const LISTING_CATEGORY_MAP: Record<string, string> = {
  house: 'HOUSE',
  land: 'LAND',
  shop: 'SHOP',
  warehouse: 'WAREHOUSE',
  hotel: 'HOTEL',
  business: 'BUSINESS',
};

// ---------------------------------------------------------------------------

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly polymorphic: PolymorphicService,
    private readonly cache: CacheService,
  ) {}

  // ── 1. GET /locations ─────────────────────────────────────────────────────

  async findAll(dto: SearchLocationDto, path: string) {
    const { page, perPage } = paginateQuery({
      page: dto.page,
      per_page: dto.per_page ?? dto.load,
    });

    const where: Prisma.LocationWhereInput = {};
    if (dto.name) {
      where.name = { contains: dto.name };
    }
    if (dto.parent_id !== undefined) {
      where.parentId = dto.parent_id;
    }

    const [locations, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.count({ where }),
    ]);

    // Batch-fetch translations for all locations on this page (avoids N+1)
    const ids = locations.map((l) => l.id);
    const translations = ids.length
      ? await this.prisma.translation.findMany({
          where: {
            translatableType: LOCATION_TYPE,
            translatableId: { in: ids },
          },
        })
      : [];

    const byId = translations.reduce<Record<number, typeof translations>>(
      (acc, t) => {
        (acc[Number(t.translatableId)] ??= []).push(t);
        return acc;
      },
      {},
    );

    const data = locations.map((loc) => {
      return {
        ...loc,
        translatable: byId[Number(loc.id)] ?? [],
      };
    });

    return paginate(data, total, page, perPage, path);
  }

  // ── 2. GET /locations/list ────────────────────────────────────────────────

  /** Returns non-subarea slugs used by the frontend for ISR. */
  async list() {
    const CACHE_KEY = 'app:locations:list';
    const cached = await this.cache.get<object[]>(CACHE_KEY);
    if (cached) return cached;

    const result = await this.prisma.location.findMany({
      where: { isSubarea: false },
      select: { slug: true },
      orderBy: { name: 'asc' },
    });

    await this.cache.set(CACHE_KEY, result, 3600); // 1 hour
    return result;
  }

  // ── 3. GET /locations/popular ─────────────────────────────────────────────

  async popular() {
    const CACHE_KEY = 'app:locations:popular';
    const cached = await this.cache.get<object[]>(CACHE_KEY);
    if (cached) return cached;

    const locations = await this.prisma.location.findMany({
      where: { isPopular: true },
      include: { _count: { select: { children: true } } },
      orderBy: { name: 'asc' },
    });

    const result = locations.map(({ _count, ...loc }) => ({
      ...loc,
      children_count: _count.children,
    }));

    await this.cache.set(CACHE_KEY, result, 3600); // 1 hour TTL
    return result;
  }

  // ── 4. GET /locations/autocomplete ────────────────────────────────────────

  async autocomplete(search: string, type?: string) {
    const term = search.trim();
    if (!term) return { location: [], property: [] };

    // Cache autocomplete results for 60 seconds to reduce DB load
    const cacheKey = `app:autocomplete:${term.toLowerCase()}:${type ?? 'all'}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    // Always search locations by name
    const locationResults = await this.prisma.location.findMany({
      where: { name: { contains: term } },
      select: {
        id: true,
        name: true,
        slug: true,
        isSubarea: true,
        parentId: true,
        parent: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });

    const properties: unknown[] = [];

    if (type) {
      const titledDelegate = TITLED_PROPERTY_MAP[type];
      const listingCategory = LISTING_CATEGORY_MAP[type];

      if (titledDelegate) {
        // Models that own a `title` + `slug` column (Apartment, OfficeBuilding, NewProject)
        const delegate = (this.prisma as unknown as Record<string, any>)[
          titledDelegate
        ];
        if (delegate) {
          const rows = (await delegate.findMany({
            where: {
              title: { contains: term },
              isPublished: true,
            },
            select: {
              id: true,
              title: true,
              slug: true,
              location: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  parent: { select: { id: true, name: true, slug: true } },
                },
              },
            },
            orderBy: { title: 'asc' },
            take: 10,
          })) as Array<{ id: number; title: string; slug: string; location?: unknown }>;

          properties.push(...rows.map((r) => ({ ...r, entity_type: type })));
        }
      } else if (listingCategory) {
        // Listing-based types: search via translation titles, then cross-check category
        const matchingTrans = await this.prisma.translation.findMany({
          where: {
            translatableType: LISTING_TYPE,
            title: { contains: term },
            lang: 'id', // primary locale
          },
          select: { translatableId: true, title: true, slug: true },
          distinct: ['translatableId'],
          take: 50, // fetch more than needed; we filter by category next
        });

        if (matchingTrans.length) {
          const listingIds = matchingTrans.map((t) => t.translatableId);

          const listings = await this.prisma.listing.findMany({
            where: {
              id: { in: listingIds },
              category: listingCategory,
              status: 'PUBLISHED',
            },
            select: { id: true },
            take: 10,
          });

          const listingIdSet = new Set(listings.map((l) => l.id));

          const matched = matchingTrans
            .filter((t) => listingIdSet.has(t.translatableId))
            .slice(0, 10);

          properties.push(
            ...matched.map((t) => ({
              id: t.translatableId,
              title: t.title,
              slug: t.slug,
              entity_type: type,
            })),
          );
        }
      }
    }

    const result = { location: locationResults, property: properties };
    await this.cache.set(cacheKey, result, 60); // 60 second TTL
    return result;
  }

  // ── 5. GET /locations/:slug ───────────────────────────────────────────────

  async findBySlug(slug: string) {
    const cacheKey = `app:locations:detail:${slug}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const location = await this.prisma.location.findUnique({
      where: { slug },
      include: {
        // Two levels of parent for breadcrumb
        parent: { include: { parent: true } },
        // Direct children
        children: { orderBy: { name: 'asc' } },
      },
    });

    if (!location) throw new NotFoundException(`Location "${slug}" not found`);

    const [translations, media] = await Promise.all([
      this.polymorphic.resolveTranslations(LOCATION_TYPE, location.id),
      this.polymorphic.resolveMedia(LOCATION_TYPE, location.id),
    ]);

    const result = { ...location, translatable: translations, media };
    await this.cache.set(cacheKey, result, 600); // 10 min TTL
    return result;
  }

  // ── 6. GET /locations/:slug/nearby ────────────────────────────────────────

  async nearby(slug: string) {
    const cacheKey = `app:locations:nearby:${slug}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const location = await this.prisma.location.findUnique({
      where: { slug },
      select: { id: true, parentId: true },
    });

    if (!location) throw new NotFoundException(`Location "${slug}" not found`);

    // Top-level locations (parentId = null) have no siblings
    if (location.parentId === null) return [];

    const siblings = await this.prisma.location.findMany({
      where: {
        parentId: location.parentId,
        NOT: { id: location.id },
      },
      orderBy: { name: 'asc' },
      take: 6,
    });

    // Batch-fetch translations for siblings
    const ids = siblings.map((s) => s.id);
    const translations = ids.length
      ? await this.prisma.translation.findMany({
          where: {
            translatableType: LOCATION_TYPE,
            translatableId: { in: ids },
          },
        })
      : [];

    const byId = translations.reduce<Record<number, typeof translations>>(
      (acc, t) => {
        (acc[Number(t.translatableId)] ??= []).push(t);
        return acc;
      },
      {},
    );

    const result = siblings.map((s) => {
      const translations = byId[Number(s.id)] ?? [];
      return { ...s, translatable: translations };
    });

    await this.cache.set(cacheKey, result, 600); // 10 min TTL
    return result;
  }

  /** Invalidate all location caches (called by admin on update). */
  async invalidateCache(): Promise<void> {
    await this.cache.delByPattern('app:locations:*');
  }

  // ── 7. GET /locations/:slug/apartments ───────────────────────────────────

  async apartments(slug: string, dto: SearchLocationDto, path: string) {
    // Verify the location exists first
    const exists = await this.prisma.location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Location "${slug}" not found`);

    const { page, perPage } = paginateQuery({
      page: dto.page,
      per_page: dto.load,
    });

    // Collect this location and all its descendants via recursive CTE
    const descendantIds = await this.getDescendantIds(slug);

    const where: Prisma.ApartmentWhereInput = {
      locationId: { in: descendantIds },
      isPublished: true,
    };
    if (dto.search) {
      where.title = { contains: dto.search };
    }

    const [apartments, total] = await Promise.all([
      this.prisma.apartment.findMany({
        where,
        include: { location: { select: { name: true, slug: true } } },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { title: 'asc' },
      }),
      this.prisma.apartment.count({ where }),
    ]);

    // Attach translations for each apartment
    const aptIds = apartments.map((a) => a.id);
    const aptTrans = aptIds.length
      ? await this.prisma.translation.findMany({
          where: {
            translatableType: 'App\\Models\\Apartment',
            translatableId: { in: aptIds },
          },
        })
      : [];

    const transById = aptTrans.reduce<Record<number, typeof aptTrans>>(
      (acc, t) => {
        (acc[Number(t.translatableId)] ??= []).push(t);
        return acc;
      },
      {},
    );

    const data = apartments.map((a) => {
      return {
        ...a,
        translatable: transById[Number(a.id)] ?? [],
      };
    });

    return paginate(data, total, page, perPage, path);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Returns the IDs of a location and ALL its descendants using a
   * PostgreSQL recursive CTE (Prisma has no native recursive relation support).
   */
  private async getDescendantIds(slug: string): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      WITH RECURSIVE descendants AS (
        SELECT id
        FROM   locations
        WHERE  slug = ${slug}

        UNION ALL

        SELECT l.id
        FROM   locations l
        INNER JOIN descendants d ON l.parent_id = d.id
      )
      SELECT id FROM descendants
    `;
    return rows.map((r) => Number(r.id));
  }
}
