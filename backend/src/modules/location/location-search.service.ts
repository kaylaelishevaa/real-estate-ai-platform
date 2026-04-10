import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../../common/services/cache.service';
import {
  ListingFilters,
  ListingService,
} from '../../common/services/listing.service';
import { paginate, paginateQuery } from '../../common/utils/pagination.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationSearchDto } from './dto/location-search.dto';

// ---------------------------------------------------------------------------
// Polymorphic type strings
// ---------------------------------------------------------------------------

const APT_TYPE = 'App\\Models\\Apartment';
const UNIT_TYPE = 'App\\Models\\ApartmentUnit';
const OB_TYPE = 'App\\Models\\OfficeBuilding';
const OFFICE_TYPE = 'App\\Models\\Office';
const HOUSE_TYPE = 'App\\Models\\House';
const LAND_TYPE = 'App\\Models\\Land';
const SHOP_TYPE = 'App\\Models\\Shop';
const WAREHOUSE_TYPE = 'App\\Models\\Warehouse';
const HOTEL_TYPE = 'App\\Models\\Hotel';
const BUSINESS_TYPE = 'App\\Models\\Business';
const NP_TYPE = 'App\\Models\\NewProject';

// ---------------------------------------------------------------------------
// Sort maps
// ---------------------------------------------------------------------------

const APT_SORT_MAP: Record<string, string> = {
  title: 'title',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

const OB_SORT_MAP: Record<string, string> = {
  title: 'title',
  created_at: 'createdAt',
};

const NP_SORT_MAP: Record<string, string> = {
  title: 'title',
  created_at: 'createdAt',
};

// ---------------------------------------------------------------------------

type LocationGroup = { locationId: number; count: number };

// ---------------------------------------------------------------------------

@Injectable()
export class LocationSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listingService: ListingService,
    private readonly cache: CacheService,
  ) {}

  // ── Main dispatcher ────────────────────────────────────────────────────────

  async search(slug: string, dto: LocationSearchDto, path: string) {
    // Merge `excludes` alias into `exclude`
    if (dto.excludes !== undefined && dto.exclude === undefined) {
      dto.exclude = dto.excludes;
    }

    const type = dto.type ?? 'apartment';
    const page = dto.page ?? 1;
    const category = dto.category ?? 'all';

    // Build a stable cache key from the search parameters
    const cacheKey = `app:listings:location:${slug}:${type}:${category}:${page}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    let result: unknown;

    switch (type) {
      case 'house':
        result = await this.searchCluster(slug, dto, path, HOUSE_TYPE, 'house');
        break;
      case 'land':
        result = await this.searchCluster(slug, dto, path, LAND_TYPE, 'land');
        break;
      case 'shop':
        result = await this.searchCluster(slug, dto, path, SHOP_TYPE, 'shop');
        break;
      case 'warehouse':
        result = await this.searchCluster(slug, dto, path, WAREHOUSE_TYPE, 'warehouse');
        break;
      case 'other_hotel':
        result = await this.searchCluster(slug, dto, path, HOTEL_TYPE, 'hotel');
        break;
      case 'other_business':
        result = await this.searchCluster(slug, dto, path, BUSINESS_TYPE, 'business');
        break;
      case 'hotel':
        result = await this.searchListings(slug, dto, path, HOTEL_TYPE, 'hotel');
        break;
      case 'business':
        result = await this.searchListings(slug, dto, path, BUSINESS_TYPE, 'business');
        break;
      case 'office':
        result = await this.searchOffice(slug, dto, path);
        break;
      case 'new_apartment':
        result = await this.searchNewProject(slug, dto, path, 'APARTMENT');
        break;
      case 'new_house':
        result = await this.searchNewProject(slug, dto, path, 'HOUSE');
        break;
      case 'new_office':
        result = await this.searchNewProject(slug, dto, path, 'OFFICE');
        break;
      case 'new_shop':
        result = await this.searchNewProject(slug, dto, path, 'SHOP');
        break;
      case 'new_warehouse':
        result = await this.searchNewProject(slug, dto, path, 'WAREHOUSE');
        break;
      case 'apartment':
      default:
        result = await this.searchApartment(slug, dto, path);
        break;
    }

    await this.cache.set(cacheKey, result, 120); // 2 min TTL
    return result;
  }

  // ── 1. Apartment ──────────────────────────────────────────────────────────

  private async searchApartment(
    slug: string,
    dto: LocationSearchDto,
    path: string,
  ) {
    const { page, perPage } = paginateQuery({
      page: dto.page,
      per_page: dto.load,
    });

    const descendantIds = await this.getDescendantIds(slug);
    if (!descendantIds.length)
      throw new NotFoundException(`Location "${slug}" not found`);

    const where: Prisma.ApartmentWhereInput = {
      locationId: { in: descendantIds },
      isPublished: true,
    };

    if (dto.search) where.title = { contains: dto.search };
    if (dto.exclude !== undefined) where.NOT = { id: dto.exclude };

    // ── Unit-level pre-filtering ─────────────────────────────────────────────
    const hasUnitFilter =
      dto.bedrooms !== undefined ||
      dto.bathrooms !== undefined ||
      dto.condition !== undefined ||
      dto.floor_zone !== undefined ||
      dto.min_building_area !== undefined ||
      dto.max_building_area !== undefined ||
      dto.is_rented !== undefined ||
      dto.has_maid_room !== undefined ||
      dto.has_study_room !== undefined ||
      dto.has_pool !== undefined ||
      dto.is_pet_allowed !== undefined ||
      dto.min_rent_in_month !== undefined;

    let aptIdsFromUnits: number[] | undefined;

    if (hasUnitFilter) {
      const unitWhere: Prisma.ApartmentUnitWhereInput = {};

      if (dto.bedrooms !== undefined) unitWhere.bedrooms = String(dto.bedrooms);
      if (dto.bathrooms !== undefined) unitWhere.bathrooms = dto.bathrooms;
      if (dto.condition) unitWhere.condition = dto.condition;
      if (dto.floor_zone) unitWhere.floorZone = dto.floor_zone;
      if (dto.is_rented !== undefined) unitWhere.isRented = dto.is_rented;
      if (dto.has_maid_room !== undefined)
        unitWhere.hasMaidRoom = dto.has_maid_room;
      if (dto.has_study_room !== undefined)
        unitWhere.hasStudyRoom = dto.has_study_room;
      if (dto.is_pet_allowed !== undefined)
        unitWhere.isPetAllowed = dto.is_pet_allowed;
      if (dto.min_rent_in_month !== undefined)
        unitWhere.minRentInMonth = { gte: dto.min_rent_in_month };

      const baFilter = this.buildAreaFilter(
        dto.min_building_area,
        dto.max_building_area,
      );
      if (baFilter) unitWhere.buildingArea = baFilter;

      const units = await this.prisma.apartmentUnit.findMany({
        where: unitWhere,
        select: { id: true, apartmentId: true },
      });
      if (!units.length) return paginate([], 0, page, perPage, path);

      if (dto.category) {
        // Only keep units that have a published listing with the requested category
        const catListings = await this.prisma.listing.findMany({
          where: {
            listingableType: UNIT_TYPE,
            listingableId: { in: units.map((u) => u.id) },
            status: 'PUBLISHED',
            category: dto.category,
          },
          select: { listingableId: true },
          distinct: ['listingableId'],
        });
        if (!catListings.length) return paginate([], 0, page, perPage, path);

        const unitIdsWithCat = new Set(catListings.map((l) => l.listingableId));
        aptIdsFromUnits = [
          ...new Set(
            units
              .filter((u) => unitIdsWithCat.has(u.id))
              .filter((u) => u.apartmentId !== null)
              .map((u) => Number(u.apartmentId)),
          ),
        ];
      } else {
        aptIdsFromUnits = [...new Set(units.filter((u) => u.apartmentId !== null).map((u) => Number(u.apartmentId)))];
      }

      if (!aptIdsFromUnits.length) return paginate([], 0, page, perPage, path);
    } else if (dto.category) {
      aptIdsFromUnits = await this.getApartmentIdsForCategory(dto.category);
      if (!aptIdsFromUnits.length) return paginate([], 0, page, perPage, path);
    }

    if (aptIdsFromUnits !== undefined) where.id = { in: aptIdsFromUnits };

    const sortKey = APT_SORT_MAP[dto.field ?? ''] ?? 'createdAt';
    const orderBy: Prisma.ApartmentOrderByWithRelationInput = {
      [sortKey]: (dto.direction ?? 'desc') as 'asc' | 'desc',
    };

    const [apartments, total] = await Promise.all([
      this.prisma.apartment.findMany({
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
      this.prisma.apartment.count({ where }),
    ]);

    if (!apartments.length) return paginate([], total, page, perPage, path);

    const aptIds = apartments.map((a) => a.id);
    const [enriched, priceData] = await Promise.all([
      this.attachTranslationsAndMedia(apartments, APT_TYPE),
      this.computeApartmentMinPrices(aptIds),
    ]);

    const data = enriched.map((a) => ({
      ...a,
      min_price: priceData[Number(a.id)]?.min_price ?? {},
      lowest_price: priceData[Number(a.id)]?.lowest_price ?? { sell: 0, rent: 0 },
    }));

    return paginate(data, total, page, perPage, path);
  }

  // ── 2. Cluster (house / land / shop / warehouse / other_hotel / other_business)

  private async searchCluster(
    slug: string,
    dto: LocationSearchDto,
    path: string,
    listingableType: string,
    kind: 'house' | 'land' | 'shop' | 'warehouse' | 'hotel' | 'business',
  ) {
    const { page, perPage } = paginateQuery({
      page: dto.page,
      per_page: dto.load,
    });

    const descendantIds = await this.getDescendantIds(slug);
    if (!descendantIds.length)
      throw new NotFoundException(`Location "${slug}" not found`);

    const propertyIds = await this.preFilterProperty(kind, dto);
    if (propertyIds !== undefined && propertyIds.length === 0) {
      return paginate([], 0, page, perPage, path);
    }

    // Count available (not sold) listings per child location
    const listingWhere = this.buildListingWhere(
      listingableType,
      descendantIds,
      propertyIds,
      dto,
    );

    const groups = await this.prisma.listing.groupBy({
      by: ['locationId'],
      where: listingWhere,
      _count: { id: true },
    });

    if (!groups.length) return paginate([], 0, page, perPage, path);

    const validGroups: LocationGroup[] = groups
      .filter((g) => g.locationId !== null)
      .map((g) => ({ locationId: Number(g.locationId), count: g._count.id }));

    return this.paginateLocationGroups(validGroups, dto, page, perPage, path, listingableType);
  }

  // ── 3. Office buildings ───────────────────────────────────────────────────

  private async searchOffice(
    slug: string,
    dto: LocationSearchDto,
    path: string,
  ) {
    const { page, perPage } = paginateQuery({
      page: dto.page,
      per_page: dto.load,
    });

    const descendantIds = await this.getDescendantIds(slug);
    if (!descendantIds.length)
      throw new NotFoundException(`Location "${slug}" not found`);

    const where: Prisma.OfficeBuildingWhereInput = {
      locationId: { in: descendantIds },
      isPublished: true,
    };

    if (dto.search) where.title = { contains: dto.search };
    if (dto.exclude !== undefined) where.NOT = { id: dto.exclude };

    if (dto.category) {
      const buildingIds = await this.getBuildingIdsForCategory(dto.category);
      if (!buildingIds.length) return paginate([], 0, page, perPage, path);
      where.id = { in: buildingIds };
    }

    const sortKey = OB_SORT_MAP[dto.field ?? ''] ?? 'createdAt';
    const orderBy: Prisma.OfficeBuildingOrderByWithRelationInput = {
      [sortKey]: (dto.direction ?? 'desc') as 'asc' | 'desc',
    };

    const [buildings, total] = await Promise.all([
      this.prisma.officeBuilding.findMany({
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
      this.prisma.officeBuilding.count({ where }),
    ]);

    if (!buildings.length) return paginate([], total, page, perPage, path);

    const buildingIds = buildings.map((b) => b.id);
    const [enriched, priceData] = await Promise.all([
      this.attachTranslationsAndMedia(buildings, OB_TYPE),
      this.computeOfficeBuildingMinPrices(buildingIds),
    ]);

    const data = enriched.map((b) => ({
      ...b,
      min_price: priceData[Number(b.id)] ?? this.emptyBuckets(),
    }));

    return paginate(data, total, page, perPage, path);
  }

  // ── 4. Hotel / Business (paginated listings) ──────────────────────────────

  private async searchListings(
    slug: string,
    dto: LocationSearchDto,
    path: string,
    listingableType: string,
    kind: 'hotel' | 'business',
  ) {
    const { page, perPage } = paginateQuery({
      page: dto.page,
      per_page: dto.load,
    });

    const locationIds = await this.getDescendantIds(slug);
    if (!locationIds.length)
      throw new NotFoundException(`Location "${slug}" not found`);

    const propertyIds = await this.preFilterProperty(kind, dto);
    if (propertyIds !== undefined && propertyIds.length === 0) {
      return paginate([], 0, page, perPage, path);
    }

    const filters: ListingFilters = {
      category: dto.category,
      minPrice: dto.min_price,
      maxPrice: dto.max_price,
      isFeatured: dto.is_featured,
      exclude: dto.exclude,
      sortField: dto.field,
      sortDirection: dto.direction as 'asc' | 'desc' | undefined,
      propertyIds,
    };

    return this.listingService.getListingsByType(
      listingableType,
      locationIds,
      filters,
      page,
      perPage,
      path,
    );
  }

  // ── 5. New Projects ───────────────────────────────────────────────────────

  private async searchNewProject(
    slug: string,
    dto: LocationSearchDto,
    path: string,
    propertyType: string,
  ) {
    const { page, perPage } = paginateQuery({
      page: dto.page,
      per_page: dto.load,
    });

    const descendantIds = await this.getDescendantIds(slug);
    if (!descendantIds.length)
      throw new NotFoundException(`Location "${slug}" not found`);

    const where: Prisma.NewProjectWhereInput = {
      locationId: { in: descendantIds },
      isPublished: true,
      propertyType,
    };

    if (dto.search) where.title = { contains: dto.search };
    if (dto.is_completed !== undefined) where.isCompleted = dto.is_completed;
    if (dto.exclude !== undefined) where.NOT = { id: dto.exclude };

    const sortKey = NP_SORT_MAP[dto.field ?? ''] ?? 'createdAt';
    const orderBy: Prisma.NewProjectOrderByWithRelationInput = {
      [sortKey]: (dto.direction ?? 'desc') as 'asc' | 'desc',
    };

    const [projects, total] = await Promise.all([
      this.prisma.newProject.findMany({
        where,
        include: {
          developer: true,
          location: { select: { id: true, name: true, slug: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy,
      }),
      this.prisma.newProject.count({ where }),
    ]);

    if (!projects.length) return paginate([], total, page, perPage, path);

    const projectIds = projects.map((p) => p.id);
    const [enriched, priceData] = await Promise.all([
      this.attachTranslationsAndMedia(projects, NP_TYPE),
      this.computeNewProjectMinPrices(projectIds),
    ]);

    const data = enriched
      .map((p) => {
        const pd = priceData[Number(p.id)];
        return {
          ...p,
          min_price: pd?.min_price ?? {},
          lowest_price: pd?.lowest_price ?? { sell: 0, rent: 0 },
          average: pd?.average ?? { price_per_sqm: { sell: 0, rent: 0 } },
          cover_image: pd?.cover_image ?? null,
        };
      })
      .filter(
        (p) => p.lowest_price.sell > 0 || p.lowest_price.rent > 0,
      );

    const filteredOut = enriched.length - data.length;
    return paginate(data, total - filteredOut, page, perPage, path);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getDescendantIds(slug: string): Promise<number[]> {
    const cacheKey = `app:locations:descendants:${slug}`;
    const cached = await this.cache.get<number[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      WITH RECURSIVE descendants AS (
        SELECT id FROM locations WHERE slug = ${slug}
        UNION ALL
        SELECT l.id FROM locations l
        INNER JOIN descendants d ON l.parent_id = d.id
      )
      SELECT id FROM descendants
    `;
    const ids = rows.map((r) => Number(r.id));
    await this.cache.set(cacheKey, ids, 3600); // 1 hour TTL (location tree rarely changes)
    return ids;
  }

  /** Apartment IDs that have ≥1 published unit listing in the given category. */
  private async getApartmentIdsForCategory(
    category: string,
  ): Promise<number[]> {
    const unitListings = await this.prisma.listing.findMany({
      where: { listingableType: UNIT_TYPE, status: 'PUBLISHED', category },
      select: { listingableId: true },
      distinct: ['listingableId'],
    });
    if (!unitListings.length) return [];

    const units = await this.prisma.apartmentUnit.findMany({
      where: { id: { in: unitListings.map((l) => l.listingableId) } },
      select: { apartmentId: true },
      distinct: ['apartmentId'],
    });
    return units.filter((u) => u.apartmentId !== null).map((u) => Number(u.apartmentId));
  }

  /** OfficeBuilding IDs that have ≥1 published office listing in the given category. */
  private async getBuildingIdsForCategory(category: string): Promise<number[]> {
    const officeListings = await this.prisma.listing.findMany({
      where: { listingableType: OFFICE_TYPE, status: 'PUBLISHED', category },
      select: { listingableId: true },
      distinct: ['listingableId'],
    });
    if (!officeListings.length) return [];

    const offices = await this.prisma.office.findMany({
      where: { id: { in: officeListings.map((l) => l.listingableId) } },
      select: { officeBuildingId: true },
      distinct: ['officeBuildingId'],
    });
    return offices.filter((o) => o.officeBuildingId !== null).map((o) => Number(o.officeBuildingId));
  }

  /**
   * Pre-filter the property-detail table by property-specific columns.
   * Returns `undefined` when no property-specific filters are active
   * (meaning all property records are eligible).
   * Returns an empty array when the filters match nothing.
   */
  private async preFilterProperty(
    kind: 'house' | 'land' | 'shop' | 'warehouse' | 'hotel' | 'business',
    dto: LocationSearchDto,
  ): Promise<number[] | undefined> {
    switch (kind) {
      case 'house': {
        const active =
          dto.bedrooms !== undefined ||
          dto.bathrooms !== undefined ||
          dto.min_land_area !== undefined ||
          dto.max_land_area !== undefined ||
          dto.min_building_area !== undefined ||
          dto.max_building_area !== undefined ||
          dto.certificate_type !== undefined ||
          dto.condition !== undefined ||
          dto.has_maid_room !== undefined ||
          dto.has_pool !== undefined ||
          dto.house_type !== undefined ||
          dto.carports !== undefined ||
          dto.min_rent_in_month !== undefined;

        if (!active) return undefined;

        const w: Prisma.HouseWhereInput = {};
        if (dto.bedrooms !== undefined) w.bedrooms = dto.bedrooms;
        if (dto.bathrooms !== undefined) w.bathrooms = dto.bathrooms;
        if (dto.certificate_type) w.certificateType = dto.certificate_type;
        if (dto.condition) w.condition = dto.condition;
        if (dto.has_maid_room !== undefined) w.hasMaidRoom = dto.has_maid_room;
        if (dto.has_pool !== undefined) w.hasPool = dto.has_pool;
        if (dto.house_type) w.houseType = dto.house_type;
        if (dto.carports !== undefined) w.carports = dto.carports;
        if (dto.min_rent_in_month !== undefined)
          w.min_rent_in_month = { gte: dto.min_rent_in_month };

        const la = this.buildAreaFilter(dto.min_land_area, dto.max_land_area);
        const ba = this.buildAreaFilter(
          dto.min_building_area,
          dto.max_building_area,
        );
        if (la) w.landArea = la;
        if (ba) w.buildingArea = ba;

        return (
          await this.prisma.house.findMany({ where: w, select: { id: true } })
        ).map((r) => Number(r.id));
      }

      case 'land': {
        const active =
          dto.min_land_area !== undefined ||
          dto.max_land_area !== undefined ||
          dto.certificate_type !== undefined ||
          dto.land_type !== undefined ||
          dto.min_rent_in_month !== undefined;

        if (!active) return undefined;

        const w: Prisma.LandWhereInput = {};
        if (dto.certificate_type) w.certificateType = dto.certificate_type;
        if (dto.land_type) w.landType = dto.land_type;
        if (dto.min_rent_in_month !== undefined)
          w.min_rent_in_month = { gte: dto.min_rent_in_month };
        const la = this.buildAreaFilter(dto.min_land_area, dto.max_land_area);
        if (la) w.landArea = la;

        return (
          await this.prisma.land.findMany({ where: w, select: { id: true } })
        ).map((r) => Number(r.id));
      }

      case 'shop': {
        const active =
          dto.min_building_area !== undefined ||
          dto.max_building_area !== undefined ||
          dto.min_land_area !== undefined ||
          dto.max_land_area !== undefined ||
          dto.certificate_type !== undefined ||
          dto.floor !== undefined ||
          dto.min_rent_in_month !== undefined;

        if (!active) return undefined;

        const w: Prisma.ShopWhereInput = {};
        if (dto.certificate_type) w.certificateType = dto.certificate_type;
        if (dto.floor !== undefined) w.floor = dto.floor;
        if (dto.min_rent_in_month !== undefined)
          w.min_rent_in_month = { gte: dto.min_rent_in_month };
        // Shop.landArea and Shop.buildingArea are String? in the schema,
        // so numeric range filters are not directly applicable.
        // We skip area filters for shops.

        return (
          await this.prisma.shop.findMany({ where: w, select: { id: true } })
        ).map((r) => Number(r.id));
      }

      case 'warehouse': {
        const active =
          dto.min_building_area !== undefined ||
          dto.max_building_area !== undefined ||
          dto.min_land_area !== undefined ||
          dto.max_land_area !== undefined ||
          dto.certificate_type !== undefined ||
          dto.warehouse_type !== undefined ||
          dto.min_rent_in_month !== undefined;

        if (!active) return undefined;

        const w: Prisma.WarehouseWhereInput = {};
        if (dto.certificate_type) w.certificateType = dto.certificate_type;
        if (dto.warehouse_type) w.warehouseType = dto.warehouse_type;
        if (dto.min_rent_in_month !== undefined)
          w.min_rent_in_month = { gte: dto.min_rent_in_month };
        const la = this.buildAreaFilter(dto.min_land_area, dto.max_land_area);
        const ba = this.buildAreaFilter(
          dto.min_building_area,
          dto.max_building_area,
        );
        if (la) w.landArea = la;
        if (ba) w.buildingArea = ba;

        return (
          await this.prisma.warehouse.findMany({
            where: w,
            select: { id: true },
          })
        ).map((r) => Number(r.id));
      }

      case 'hotel': {
        const active =
          dto.min_building_area !== undefined ||
          dto.max_building_area !== undefined ||
          dto.min_land_area !== undefined ||
          dto.max_land_area !== undefined ||
          dto.rating !== undefined ||
          dto.hotel_type !== undefined ||
          dto.is_chain !== undefined ||
          dto.room !== undefined ||
          dto.established !== undefined;

        if (!active) return undefined;

        const w: Prisma.HotelWhereInput = {};
        if (dto.rating) w.rating = dto.rating;
        if (dto.hotel_type) w.hotelType = dto.hotel_type;
        if (dto.is_chain !== undefined) w.is_chain = dto.is_chain;
        if (dto.room !== undefined) w.room = { gte: dto.room };
        if (dto.established !== undefined) w.established = dto.established;
        const la = this.buildAreaFilter(dto.min_land_area, dto.max_land_area);
        const ba = this.buildAreaFilter(
          dto.min_building_area,
          dto.max_building_area,
        );
        if (la) w.landArea = la;
        if (ba) w.buildingArea = ba;

        return (
          await this.prisma.hotel.findMany({ where: w, select: { id: true } })
        ).map((r) => Number(r.id));
      }

      case 'business': {
        const active =
          dto.min_building_area !== undefined ||
          dto.max_building_area !== undefined ||
          dto.min_land_area !== undefined ||
          dto.max_land_area !== undefined ||
          dto.business_type !== undefined ||
          dto.established !== undefined;

        if (!active) return undefined;

        const w: Prisma.BusinessWhereInput = {};
        if (dto.business_type) w.businessType = dto.business_type;
        if (dto.established !== undefined) w.established = dto.established;
        const la = this.buildAreaFilter(dto.min_land_area, dto.max_land_area);
        const ba = this.buildAreaFilter(
          dto.min_building_area,
          dto.max_building_area,
        );
        if (la) w.landArea = la;
        if (ba) w.buildingArea = ba;

        return (
          await this.prisma.business.findMany({
            where: w,
            select: { id: true },
          })
        ).map((r) => Number(r.id));
      }
    }
  }

  /** Build a Prisma IntNullableFilter for an area range (returns undefined if neither bound given). */
  private buildAreaFilter(
    min?: number,
    max?: number,
  ): Prisma.IntNullableFilter | undefined {
    if (min === undefined && max === undefined) return undefined;
    const f: Prisma.IntNullableFilter = {};
    if (min !== undefined) f.gte = min;
    if (max !== undefined) f.lte = max;
    return f;
  }

  /**
   * Build a listing WHERE clause used by cluster handlers.
   * Counts only available (not-sold) published listings.
   */
  private buildListingWhere(
    listingableType: string,
    locationIds: number[],
    propertyIds: number[] | undefined,
    dto: LocationSearchDto,
  ): Prisma.ListingWhereInput {
    const where: Prisma.ListingWhereInput = {
      listingableType,
      locationId: { in: locationIds },
      status: 'PUBLISHED',
      price: { gt: 0 },
      soldAt: null,
    };

    if (propertyIds) where.listingableId = { in: propertyIds };
    if (dto.category) where.category = dto.category;
    if (dto.is_featured) where.isFeatured = true;
    if (dto.exclude !== undefined) where.NOT = { id: dto.exclude };

    if (dto.min_price || dto.max_price) {
      const pf: Prisma.BigIntNullableFilter = {};
      if (dto.min_price) pf.gte = BigInt(dto.min_price);
      if (dto.max_price) pf.lte = BigInt(dto.max_price);
      where.price = pf;
    }

    return where;
  }

  /**
   * Sort location groups and return a paginated result.
   * Default sort: total_available desc.
   * When field='name': sort by location name (DB-side for the full set).
   */
  private async paginateLocationGroups(
    groups: LocationGroup[],
    dto: LocationSearchDto,
    page: number,
    perPage: number,
    path: string,
    listingableType?: string,
  ) {
    const total = groups.length;

    // Default: sort by total_available
    const dir = dto.direction === 'asc' ? 1 : -1;
    let sorted: LocationGroup[];

    if (dto.field === 'name') {
      // Fetch all matched locations sorted by name, then figure out order
      const allIds = groups.map((g) => g.locationId);
      const allLocations = await this.prisma.location.findMany({
        where: { id: { in: allIds } },
        orderBy: { name: (dto.direction ?? 'asc') as 'asc' | 'desc' },
      });
      const orderMap = new Map(allLocations.map((l, i) => [Number(l.id), i]));
      sorted = [...groups].sort(
        (a, b) => (orderMap.get(a.locationId) ?? 0) - (orderMap.get(b.locationId) ?? 0),
      );
    } else {
      sorted = [...groups].sort((a, b) => dir * (b.count - a.count));
    }

    const paged = sorted.slice((page - 1) * perPage, page * perPage);
    if (!paged.length) return paginate([], total, page, perPage, path);

    const locationIds = paged.map((g) => g.locationId);
    const locations = await this.prisma.location.findMany({
      where: { id: { in: locationIds } },
    });
    const locationById = new Map(locations.map((l) => [Number(l.id), l]));
    const countById = new Map(groups.map((g) => [g.locationId, g.count]));

    // Compute min_price area buckets if we have a listingable type
    let minPriceByLoc = new Map<number, Record<string, { sell: number; rent: number }>>();
    if (listingableType) {
      minPriceByLoc = await this.computeAreaBuckets(listingableType, locationIds);
    }

    const data = paged
      .map((g) => {
        const loc = locationById.get(g.locationId);
        if (!loc) return null;
        return {
          ...loc,
          total_available: countById.get(g.locationId) ?? 0,
          min_price: minPriceByLoc.get(g.locationId) ?? this.emptyBuckets(),
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    return paginate(data, total, page, perPage, path);
  }

  // ── Area bucket computation for office buildings ───────────────────────────

  /**
   * Batch-compute per-area-bucket min_price for a set of office buildings.
   * Returns { [buildingId]: { _0_150: { sell, rent }, _151_300: { sell, rent }, ... } }
   */
  private async computeOfficeBuildingMinPrices(
    buildingIds: (bigint | number)[],
  ): Promise<Record<number, Record<string, { sell: number; rent: number }>>> {
    if (!buildingIds.length) return {};

    const offices = await this.prisma.office.findMany({
      where: { officeBuildingId: { in: buildingIds.map((id) => BigInt(id)) } },
      select: { id: true, officeBuildingId: true, buildingArea: true },
    });

    if (!offices.length) return {};

    const officeIds = offices.map((o) => o.id);

    const listings = await this.prisma.listing.findMany({
      where: {
        listingableType: OFFICE_TYPE,
        listingableId: { in: officeIds },
        status: 'PUBLISHED',
        price: { gt: 0 },
      },
      select: { listingableId: true, category: true, price: true },
    });

    const officeById = new Map(offices.map((o) => [Number(o.id), o]));

    const result: Record<number, Record<string, { sell: number; rent: number }>> = {};
    for (const bid of buildingIds) {
      result[Number(bid)] = this.emptyBuckets();
    }

    for (const listing of listings) {
      const office = officeById.get(Number(listing.listingableId));
      if (!office || listing.price == null) continue;

      const buckets = result[Number(office.officeBuildingId)];
      if (!buckets) continue;

      const area = office.buildingArea;
      if (area == null) continue;

      const catKey = listing.category === 'SELL' ? 'sell' : 'rent';
      const priceNum = Number(listing.price);

      for (const bucket of LocationSearchService.AREA_BUCKETS) {
        if (bucket.min !== null && area < bucket.min) continue;
        if (bucket.max !== null && area > bucket.max) continue;
        const current = buckets[bucket.key][catKey];
        if (current === 0 || priceNum < current) {
          buckets[bucket.key][catKey] = priceNum;
        }
      }
    }

    return result;
  }

  // ── Area bucket computation for cluster locations ──────────────────────────

  private static readonly AREA_BUCKETS = [
    { key: '_0_150', min: null as number | null, max: 150 as number | null },
    { key: '_151_300', min: 151, max: 300 },
    { key: '_301_500', min: 301, max: 500 },
    { key: '_500_', min: 501, max: null as number | null },
  ];

  private static readonly AREA_MODEL_MAP: Record<string, { delegate: string; areaField: string }> = {
    'App\\Models\\House': { delegate: 'house', areaField: 'buildingArea' },
    'App\\Models\\Land': { delegate: 'land', areaField: 'landArea' },
    'App\\Models\\Shop': { delegate: 'shop', areaField: 'buildingArea' },
    'App\\Models\\Warehouse': { delegate: 'warehouse', areaField: 'buildingArea' },
  };

  private emptyBuckets(): Record<string, { sell: number; rent: number }> {
    return Object.fromEntries(
      LocationSearchService.AREA_BUCKETS.map((b) => [b.key, { sell: 0, rent: 0 }]),
    );
  }

  private async computeAreaBuckets(
    listingableType: string,
    locationIds: number[],
  ): Promise<Map<number, Record<string, { sell: number; rent: number }>>> {
    const result = new Map<number, Record<string, { sell: number; rent: number }>>();
    if (!locationIds.length) return result;

    const modelInfo = LocationSearchService.AREA_MODEL_MAP[listingableType];
    if (!modelInfo) {
      for (const id of locationIds) result.set(id, this.emptyBuckets());
      return result;
    }

    const listings = await this.prisma.listing.findMany({
      where: {
        listingableType,
        locationId: { in: locationIds },
        status: 'PUBLISHED',
        price: { gt: 0 },
      },
      select: { listingableId: true, locationId: true, category: true, price: true },
    });

    if (!listings.length) {
      for (const id of locationIds) result.set(id, this.emptyBuckets());
      return result;
    }

    const propIds = [...new Set(listings.map((l) => l.listingableId))];
    const delegate = (this.prisma as unknown as Record<string, any>)[modelInfo.delegate];
    if (!delegate?.findMany) {
      for (const id of locationIds) result.set(id, this.emptyBuckets());
      return result;
    }

    const props = (await delegate.findMany({
      where: { id: { in: propIds } },
      select: { id: true, [modelInfo.areaField]: true },
    })) as Array<{ id: bigint; [key: string]: unknown }>;

    const areaById = new Map<number, number>();
    for (const p of props) {
      const area = p[modelInfo.areaField];
      if (typeof area === 'number' && area > 0) areaById.set(Number(p.id), area);
    }

    for (const id of locationIds) result.set(id, this.emptyBuckets());

    for (const l of listings) {
      if (l.price == null || l.locationId == null) continue;
      const area = areaById.get(Number(l.listingableId));
      if (area == null) continue;

      const locId = Number(l.locationId);
      const buckets = result.get(locId);
      if (!buckets) continue;

      const catKey = l.category === 'SELL' ? 'sell' : 'rent';
      const priceNum = Number(l.price);

      for (const bucket of LocationSearchService.AREA_BUCKETS) {
        if (bucket.min !== null && area < bucket.min) continue;
        if (bucket.max !== null && area > bucket.max) continue;
        const current = buckets[bucket.key][catKey];
        if (current === 0 || priceNum < current) {
          buckets[bucket.key][catKey] = priceNum;
        }
      }
    }

    return result;
  }

  /**
   * Batch-fetch translations + media for a page of model records (N+1-safe).
   * Works for Apartment, OfficeBuilding, and NewProject.
   */
  private async attachTranslationsAndMedia<T extends { id: bigint | number }>(
    items: T[],
    entityType: string,
  ): Promise<Array<T & { translatable: unknown[]; media: unknown[] }>> {
    const ids = items.map((i) => (typeof i.id === 'bigint' ? i.id : BigInt(i.id)));

    const [allTrans, allMedia] = await Promise.all([
      this.prisma.translation.findMany({
        where: { translatableType: entityType, translatableId: { in: ids } },
      }),
      this.prisma.media.findMany({
        where: { mediableType: entityType, mediableId: { in: ids } },
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

    return items.map((i) => {
      const numId = Number(i.id);
      return {
        ...i,
        translatable: transById[numId] ?? [],
        media: mediaById[numId] ?? [],
      };
    });
  }

  // ── Bedroom-keyed min_price for apartments (and new projects) ───────────

  private readonly BEDROOM_KEYS: Record<string, string> = {
    STUDIO: 'studio',
    ONE_BEDROOM: 'one_bedroom',
    TWO_BEDROOMS: 'two_bedrooms',
    THREE_BEDROOMS: 'three_bedrooms',
    FOUR_BEDROOMS: 'four_bedrooms',
    FIVE_BEDROOMS: 'five_bedrooms',
    SIX_BEDROOMS: 'six_bedrooms',
    SEVEN_BEDROOMS: 'seven_bedrooms',
    EIGHT_BEDROOMS: 'eight_bedrooms',
  };

  /**
   * For a page of apartments, batch-compute the per-bedroom min_price
   * and lowest_price that the Laravel API used to return.
   *
   * Shape of min_price:
   * {
   *   studio:         { sell: number|null, rent: number|null },
   *   one_bedroom:    { sell: number|null, rent: number|null },
   *   two_bedrooms:   { sell: number|null, rent: number|null },
   *   three_bedrooms: { sell: number|null, rent: number|null },
   *   ...
   * }
   *
   * Shape of lowest_price: { sell: number|null, rent: number|null }
   */
  private async computeApartmentMinPrices(
    apartmentIds: (bigint | number)[],
  ): Promise<
    Record<
      number,
      {
        min_price: Record<string, { sell: number; rent: number }>;
        lowest_price: { sell: number; rent: number };
      }
    >
  > {
    if (!apartmentIds.length) return {};

    // 1. Get all units for these apartments
    const units = await this.prisma.apartmentUnit.findMany({
      where: { apartmentId: { in: apartmentIds.map((id) => BigInt(id)) } },
      select: { id: true, apartmentId: true, bedrooms: true },
    });

    if (!units.length) return {};

    const unitIds = units.map((u) => u.id);

    // 2. Get all published listings for these units
    const listings = await this.prisma.listing.findMany({
      where: {
        listingableType: UNIT_TYPE,
        listingableId: { in: unitIds },
        status: 'PUBLISHED',
      },
      select: { listingableId: true, category: true, price: true },
    });

    // 3. Index units by id
    const unitById = new Map(units.map((u) => [Number(u.id), u]));

    // 4. Build result per apartment
    const result: Record<
      number,
      {
        min_price: Record<string, { sell: number; rent: number }>;
        lowest_price: { sell: number; rent: number };
      }
    > = {};

    for (const aptId of apartmentIds) {
      const numId = Number(aptId);
      const minPrice: Record<string, { sell: number; rent: number }> = {};
      // Initialise all bedroom keys
      for (const key of Object.values(this.BEDROOM_KEYS)) {
        minPrice[key] = { sell: 0, rent: 0 };
      }

      result[numId] = { min_price: minPrice, lowest_price: { sell: 0, rent: 0 } };
    }

    for (const listing of listings) {
      const unit = unitById.get(Number(listing.listingableId));
      if (!unit || listing.price == null) continue;

      const aptResult = result[Number(unit.apartmentId)];
      if (!aptResult) continue;

      const priceNum = Number(listing.price);
      const catKey = listing.category === 'SELL' ? 'sell' : 'rent';

      // Update bedroom-specific price
      const bedroomKey = unit.bedrooms
        ? this.BEDROOM_KEYS[unit.bedrooms]
        : undefined;
      if (bedroomKey) {
        const current = aptResult.min_price[bedroomKey][catKey];
        if (current === 0 || priceNum < current) {
          aptResult.min_price[bedroomKey][catKey] = priceNum;
        }
      }

      // Update lowest_price
      const currentLowest = aptResult.lowest_price[catKey];
      if (currentLowest === 0 || priceNum < currentLowest) {
        aptResult.lowest_price[catKey] = priceNum;
      }
    }

    return result;
  }

  /**
   * Same computation for new projects (uses NewProjectUnit).
   */
  private async computeNewProjectMinPrices(
    projectIds: (bigint | number)[],
  ): Promise<
    Record<
      number,
      {
        min_price: Record<string, { sell: number; rent: number }>;
        lowest_price: { sell: number; rent: number };
        average: { price_per_sqm: { sell: number; rent: number } };
        cover_image: string | null;
      }
    >
  > {
    if (!projectIds.length) return {};

    const NP_UNIT_TYPE = 'App\\Models\\NewProjectUnit';

    // 1. Get all units for these projects
    const units = await this.prisma.newProjectUnit.findMany({
      where: { newProjectId: { in: projectIds.map((id) => BigInt(id)) } },
      select: { id: true, newProjectId: true, bedrooms: true },
    });

    const unitIds = units.length ? units.map((u) => u.id) : [];

    // 2. Get all published listings for these units
    const listings = unitIds.length
      ? await this.prisma.listing.findMany({
          where: {
            listingableType: NP_UNIT_TYPE,
            listingableId: { in: unitIds },
            status: 'PUBLISHED',
          },
          select: {
            listingableId: true,
            category: true,
            price: true,
            pricePerSqm: true,
          },
        })
      : [];

    // 3. Get media for cover_image
    const allMedia = await this.prisma.media.findMany({
      where: {
        mediableType: NP_TYPE,
        mediableId: { in: projectIds.map((id) => BigInt(id)) },
      },
      orderBy: { ordinal: 'asc' },
    });

    const mediaByProjectId = allMedia.reduce<Record<number, string>>(
      (acc, m) => {
        if (!acc[Number(m.mediableId)]) acc[Number(m.mediableId)] = m.url;
        return acc;
      },
      {},
    );

    // 4. Index units by id
    const unitById = new Map(units.map((u) => [Number(u.id), u]));

    // 5. Build result
    const result: Record<
      number,
      {
        min_price: Record<string, { sell: number; rent: number }>;
        lowest_price: { sell: number; rent: number };
        average: { price_per_sqm: { sell: number; rent: number } };
        cover_image: string | null;
      }
    > = {};

    for (const pid of projectIds) {
      const numPid = Number(pid);
      const minPrice: Record<string, { sell: number; rent: number }> = {};
      for (const key of Object.values(this.BEDROOM_KEYS)) {
        minPrice[key] = { sell: 0, rent: 0 };
      }
      result[numPid] = {
        min_price: minPrice,
        lowest_price: { sell: 0, rent: 0 },
        average: { price_per_sqm: { sell: 0, rent: 0 } },
        cover_image: mediaByProjectId[numPid] ?? null,
      };
    }

    // Accumulators for average price_per_sqm
    const sqmAccum: Record<
      number,
      { sell: { sum: number; count: number }; rent: { sum: number; count: number } }
    > = {};
    for (const pid of projectIds) {
      sqmAccum[Number(pid)] = {
        sell: { sum: 0, count: 0 },
        rent: { sum: 0, count: 0 },
      };
    }

    for (const listing of listings) {
      const unit = unitById.get(Number(listing.listingableId));
      if (!unit || listing.price == null) continue;

      const r = result[Number(unit.newProjectId)];
      if (!r) continue;

      const priceNum = Number(listing.price);
      const catKey = listing.category === 'SELL' ? 'sell' : 'rent';

      // Bedroom-specific price
      const bedroomKey = unit.bedrooms
        ? this.BEDROOM_KEYS[unit.bedrooms]
        : undefined;
      if (bedroomKey) {
        const current = r.min_price[bedroomKey][catKey];
        if (current === 0 || priceNum < current) {
          r.min_price[bedroomKey][catKey] = priceNum;
        }
      }

      // Lowest price
      const currentLowest = r.lowest_price[catKey];
      if (currentLowest === 0 || priceNum < currentLowest) {
        r.lowest_price[catKey] = priceNum;
      }

      // Price per sqm accumulator
      if (listing.pricePerSqm != null) {
        const sqm = Number(listing.pricePerSqm);
        const acc = sqmAccum[Number(unit.newProjectId)];
        if (acc) {
          acc[catKey].sum += sqm;
          acc[catKey].count += 1;
        }
      }
    }

    // Finalize averages
    for (const pid of projectIds) {
      const numPid = Number(pid);
      const acc = sqmAccum[numPid];
      const r = result[numPid];
      if (acc && r) {
        r.average.price_per_sqm.sell =
          acc.sell.count > 0 ? Math.round(acc.sell.sum / acc.sell.count) : 0;
        r.average.price_per_sqm.rent =
          acc.rent.count > 0 ? Math.round(acc.rent.sum / acc.rent.count) : 0;
      }
    }

    return result;
  }
}
