import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from './cache.service';
import { PrismaService } from '../../prisma/prisma.service';

// ---------------------------------------------------------------------------

type PriceKey = string;

interface PriceRange {
  min: bigint | null;
  max: bigint | null;
}

/** Area bucket for min_price — matches what the frontend ClusterCard expects. */
interface AreaBucket {
  sell: number;
  rent: number;
}

export interface ClusterChild {
  id: number;
  name: string;
  slug: string;
  picture: string | null;
  parentId: number | null;
  parent_id: number | null;
  isSubarea: boolean | null;
  is_subarea: boolean | null;
  total: number;
  available: number;
  sell_min: number | null;
  sell_max: number | null;
  rent_min: number | null;
  rent_max: number | null;
  min_price: Record<string, AreaBucket>;
}

export interface ClusterResult {
  id: number;
  name: string;
  slug: string;
  picture: string | null;
  latitude: string | null;
  longitude: string | null;
  parentId: number | null;
  parent_id: number | null;
  parent: Record<string, unknown> | null;
  children: ClusterChild[];
  range: {
    price: { sell: [number, number]; rent: [number, number] };
    bedrooms: { sell: number[]; rent: number[] };
    bathrooms: { sell: number[]; rent: number[] };
    carports: { sell: number[]; rent: number[] };
    available: { sell: number; rent: number };
    total: { sell: number; rent: number };
  };
}

// For backwards compat
export type ClusterItem = ClusterChild;

// ---------------------------------------------------------------------------

// Area bucket ranges in m²
const AREA_BUCKETS: Array<{ key: string; min: number | null; max: number | null }> = [
  { key: '_0_150', min: null, max: 150 },
  { key: '_151_300', min: 151, max: 300 },
  { key: '_301_500', min: 301, max: 500 },
  { key: '_500_', min: 501, max: null },
];

// Map listingableType → Prisma delegate name for area lookup
const AREA_MODEL_MAP: Record<string, { delegate: string; areaField: string }> = {
  'App\\Models\\House': { delegate: 'house', areaField: 'buildingArea' },
  'App\\Models\\Land': { delegate: 'land', areaField: 'landArea' },
  'App\\Models\\Shop': { delegate: 'shop', areaField: 'buildingArea' },
  'App\\Models\\Warehouse': { delegate: 'warehouse', areaField: 'buildingArea' },
};

// ---------------------------------------------------------------------------

@Injectable()
export class ClusterQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Returns the parent location object with cluster children, each child
   * enriched with listing counts, price ranges, and min_price area buckets.
   *
   * The frontend house/land/shop/warehouse cluster pages use this as:
   *   property.name, property.parent.slug, property.picture (from the parent)
   *   property.children → Card.Cluster items with min_price area buckets
   *
   * @throws NotFoundException when the location slug doesn't exist.
   */
  async getCluster(
    listingableType: string,
    locationSlug: string,
  ): Promise<ClusterResult> {
    const typeKey = listingableType.replace(/.*\\/, '').toLowerCase();
    const cacheKey = `app:cluster:${typeKey}:${locationSlug}`;
    const cached = await this.cache.get<ClusterResult>(cacheKey);
    if (cached) return cached;

    // ── 1. Fetch location + parent + direct children ────────────────────────
    const location = await this.prisma.location.findUnique({
      where: { slug: locationSlug },
      include: {
        parent: true,
        children: {
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!location) {
      throw new NotFoundException(`Location "${locationSlug}" not found`);
    }

    // ── 2. Choose cluster locations ─────────────────────────────────────────
    const clusterLocations =
      location.children.length > 0
        ? location.children
        : [location];

    const clusterIds = clusterLocations.map((l) => Number(l.id));

    // ── 3. Listing stats per location ───────────────────────────────────────
    const [totalGroups, availableGroups, priceGroups] = await Promise.all([
      this.prisma.listing.groupBy({
        by: ['locationId'],
        where: {
          listingableType,
          locationId: { in: clusterIds },
          status: 'PUBLISHED',
        },
        _count: { id: true },
      }),
      this.prisma.listing.groupBy({
        by: ['locationId'],
        where: {
          listingableType,
          locationId: { in: clusterIds },
          status: 'PUBLISHED',
          soldAt: null,
        },
        _count: { id: true },
      }),
      this.prisma.listing.groupBy({
        by: ['locationId', 'category'],
        where: {
          listingableType,
          locationId: { in: clusterIds },
          status: 'PUBLISHED',
          price: { not: null },
        },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);

    const totalMap = new Map<number, number>(
      totalGroups.filter((g) => g.locationId !== null).map((g) => [Number(g.locationId), g._count.id]),
    );
    const availableMap = new Map<number, number>(
      availableGroups.filter((g) => g.locationId !== null).map((g) => [Number(g.locationId), g._count.id]),
    );
    const priceMap = new Map<PriceKey, PriceRange>();
    for (const g of priceGroups) {
      if (g.locationId === null) continue;
      priceMap.set(`${Number(g.locationId)}:${g.category}`, {
        min: g._min.price ?? null,
        max: g._max.price ?? null,
      });
    }

    // ── 4. Compute min_price area buckets per location ──────────────────────
    const minPriceByLocation = await this.computeAreaBuckets(
      listingableType,
      clusterIds,
    );

    // ── 5. Assemble children ────────────────────────────────────────────────
    const children: ClusterChild[] = clusterLocations
      .filter((loc) => (totalMap.get(Number(loc.id)) ?? 0) > 0)
      .map((loc) => {
        const numId = Number(loc.id);
        const sellData = priceMap.get(`${numId}:SELL`);
        const rentData = priceMap.get(`${numId}:RENT`);

        return {
          id: numId,
          name: loc.name,
          slug: loc.slug,
          picture: loc.picture ?? null,
          parentId: loc.parentId !== null ? Number(loc.parentId) : null,
          parent_id: loc.parentId !== null ? Number(loc.parentId) : null,
          isSubarea: loc.isSubarea,
          is_subarea: loc.isSubarea,
          total: totalMap.get(numId) ?? 0,
          available: availableMap.get(numId) ?? 0,
          sell_min: sellData?.min != null ? Number(sellData.min) : null,
          sell_max: sellData?.max != null ? Number(sellData.max) : null,
          rent_min: rentData?.min != null ? Number(rentData.min) : null,
          rent_max: rentData?.max != null ? Number(rentData.max) : null,
          min_price: minPriceByLocation.get(numId) ?? this.emptyBuckets(),
        };
      });

    // ── 6. Aggregate totals and compute property ranges ──────────────────────
    let sellMinAll: bigint | null = null;
    let sellMaxAll: bigint | null = null;
    let rentMinAll: bigint | null = null;
    let rentMaxAll: bigint | null = null;

    for (const g of priceGroups) {
      if (g.category === 'SELL') {
        if (g._min.price != null && (sellMinAll === null || g._min.price < sellMinAll)) sellMinAll = g._min.price;
        if (g._max.price != null && (sellMaxAll === null || g._max.price > sellMaxAll)) sellMaxAll = g._max.price;
      } else if (g.category === 'RENT') {
        if (g._min.price != null && (rentMinAll === null || g._min.price < rentMinAll)) rentMinAll = g._min.price;
        if (g._max.price != null && (rentMaxAll === null || g._max.price > rentMaxAll)) rentMaxAll = g._max.price;
      }
    }

    // Count totals by category (SELL vs RENT)
    const catGroups = await this.prisma.listing.groupBy({
      by: ['category'],
      where: {
        listingableType,
        locationId: { in: clusterIds },
        status: 'PUBLISHED',
      },
      _count: { id: true },
    });
    const catAvailGroups = await this.prisma.listing.groupBy({
      by: ['category'],
      where: {
        listingableType,
        locationId: { in: clusterIds },
        status: 'PUBLISHED',
        soldAt: null,
      },
      _count: { id: true },
    });

    const sellTotal = catGroups.find((g) => g.category === 'SELL')?._count.id ?? 0;
    const rentTotal = catGroups.find((g) => g.category === 'RENT')?._count.id ?? 0;
    const sellAvail = catAvailGroups.find((g) => g.category === 'SELL')?._count.id ?? 0;
    const rentAvail = catAvailGroups.find((g) => g.category === 'RENT')?._count.id ?? 0;

    // Compute bedroom/bathroom/carport ranges from property records
    const propertyRange = await this.computePropertyRange(listingableType, clusterIds);

    const result: ClusterResult = {
      id: Number(location.id),
      name: location.name,
      slug: location.slug,
      picture: location.picture ?? null,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      parentId: location.parentId !== null ? Number(location.parentId) : null,
      parent_id: location.parentId !== null ? Number(location.parentId) : null,
      parent: location.parent
        ? {
            id: Number(location.parent.id),
            name: location.parent.name,
            slug: location.parent.slug,
          }
        : null,
      children,
      range: {
        price: {
          sell: [sellMinAll != null ? Number(sellMinAll) : 0, sellMaxAll != null ? Number(sellMaxAll) : 0],
          rent: [rentMinAll != null ? Number(rentMinAll) : 0, rentMaxAll != null ? Number(rentMaxAll) : 0],
        },
        bedrooms: propertyRange.bedrooms,
        bathrooms: propertyRange.bathrooms,
        carports: propertyRange.carports,
        available: { sell: sellAvail, rent: rentAvail },
        total: { sell: sellTotal, rent: rentTotal },
      },
    };

    await this.cache.set(cacheKey, result, 300); // 5 min TTL
    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Compute unique bedroom/bathroom/carport values split by SELL/RENT
   * from the property records linked to published listings.
   */
  private async computePropertyRange(
    listingableType: string,
    locationIds: number[],
  ): Promise<{
    bedrooms: { sell: number[]; rent: number[] };
    bathrooms: { sell: number[]; rent: number[] };
    carports: { sell: number[]; rent: number[] };
  }> {
    const empty = {
      bedrooms: { sell: [] as number[], rent: [] as number[] },
      bathrooms: { sell: [] as number[], rent: [] as number[] },
      carports: { sell: [] as number[], rent: [] as number[] },
    };

    // Only House has bedrooms/bathrooms/carports
    if (listingableType !== 'App\\Models\\House') return empty;

    const listings = await this.prisma.listing.findMany({
      where: {
        listingableType,
        locationId: { in: locationIds },
        status: 'PUBLISHED',
      },
      select: { listingableId: true, category: true },
    });

    if (!listings.length) return empty;

    const propIds = [...new Set(listings.map((l) => l.listingableId))];
    const houses = await this.prisma.house.findMany({
      where: { id: { in: propIds } },
      select: { id: true, bedrooms: true, bathrooms: true, carports: true },
    });

    const houseById = new Map(houses.map((h) => [Number(h.id), h]));

    const sellBedrooms = new Set<number>();
    const rentBedrooms = new Set<number>();
    const sellBathrooms = new Set<number>();
    const rentBathrooms = new Set<number>();
    const sellCarports = new Set<number>();
    const rentCarports = new Set<number>();

    for (const l of listings) {
      const h = houseById.get(Number(l.listingableId));
      if (!h) continue;
      const isSell = l.category === 'SELL';

      if (h.bedrooms != null) (isSell ? sellBedrooms : rentBedrooms).add(h.bedrooms);
      if (h.bathrooms != null) (isSell ? sellBathrooms : rentBathrooms).add(h.bathrooms);
      if (h.carports != null) (isSell ? sellCarports : rentCarports).add(h.carports);
    }

    return {
      bedrooms: { sell: [...sellBedrooms].sort((a, b) => a - b), rent: [...rentBedrooms].sort((a, b) => a - b) },
      bathrooms: { sell: [...sellBathrooms].sort((a, b) => a - b), rent: [...rentBathrooms].sort((a, b) => a - b) },
      carports: { sell: [...sellCarports].sort((a, b) => a - b), rent: [...rentCarports].sort((a, b) => a - b) },
    };
  }

  /**
   * Compute min_price by area bucket for each cluster location.
   * Returns Map<locationId, { _0_150: { sell, rent }, _151_300: ..., ... }>
   */
  private async computeAreaBuckets(
    listingableType: string,
    locationIds: number[],
  ): Promise<Map<number, Record<string, AreaBucket>>> {
    const result = new Map<number, Record<string, AreaBucket>>();
    if (!locationIds.length) return result;

    const modelInfo = AREA_MODEL_MAP[listingableType];
    if (!modelInfo) {
      // No area data available — return empty buckets
      for (const id of locationIds) result.set(id, this.emptyBuckets());
      return result;
    }

    // Fetch all published listings for these locations
    const listings = await this.prisma.listing.findMany({
      where: {
        listingableType,
        locationId: { in: locationIds },
        status: 'PUBLISHED',
        price: { gt: 0 },
      },
      select: {
        listingableId: true,
        locationId: true,
        category: true,
        price: true,
      },
    });

    if (!listings.length) {
      for (const id of locationIds) result.set(id, this.emptyBuckets());
      return result;
    }

    // Fetch property records to get area
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
      if (typeof area === 'number' && area > 0) {
        areaById.set(Number(p.id), area);
      }
    }

    // Init buckets per location
    for (const id of locationIds) result.set(id, this.emptyBuckets());

    // Compute min prices per bucket per location
    for (const l of listings) {
      if (l.price == null || l.locationId == null) continue;
      const area = areaById.get(Number(l.listingableId));
      if (area == null) continue;

      const locId = Number(l.locationId);
      const buckets = result.get(locId);
      if (!buckets) continue;

      const catKey = l.category === 'SELL' ? 'sell' : 'rent';
      const priceNum = Number(l.price);

      for (const bucket of AREA_BUCKETS) {
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

  private emptyBuckets(): Record<string, AreaBucket> {
    return Object.fromEntries(AREA_BUCKETS.map((b) => [b.key, { sell: 0, rent: 0 }]));
  }
}
