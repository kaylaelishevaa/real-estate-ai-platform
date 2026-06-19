import { Injectable } from '@nestjs/common';
import type { Prisma, SyncLog } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ---------------------------------------------------------------------------

export interface CreateSyncLogDto {
  listingId: bigint | number;
  target: string;
  action: string;
  status: string;
  externalId?: string | null;
  // Prisma's InputJsonValue is used for nullable Json fields.
  // Omit (undefined) to leave the column untouched.
  requestBody?: Prisma.InputJsonValue;
  responseBody?: Prisma.InputJsonValue;
  errorMessage?: string | null;
}

export interface UpdateSyncLogDto {
  status?: string;
  externalId?: string | null;
  requestBody?: Prisma.InputJsonValue;
  responseBody?: Prisma.InputJsonValue;
  errorMessage?: string | null;
  attempts?: number;
}

// ---------------------------------------------------------------------------

@Injectable()
export class SyncLogService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Most-recent **successful** log for a listing + target pair.
   * Used by the orchestrator to retrieve the externalId for update/deactivate.
   */
  async getSyncStatus(
    listingId: bigint | number,
    target: string,
  ): Promise<SyncLog | null> {
    return this.prisma.syncLog.findFirst({
      where: { listingId, target, status: 'success' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Count of sync log records grouped by target + status.
   * Returned as-is from Prisma groupBy so callers can format as needed.
   */
  async getStatusCounts() {
    return this.prisma.syncLog.groupBy({
      by: ['target', 'status'],

      _count: { id: true },
      orderBy: [{ target: 'asc' }, { status: 'asc' }],
    });
  }

  /**
   * Most-recent failed logs, newest first.
   * Includes a slim listing projection so callers have enough context.
   */
  async getRecentFailures(limit = 50) {
    return this.prisma.syncLog.findMany({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        listing: {
          select: {
            id: true,
            propertyId: true,
            listingableType: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * Count of sync log records grouped by target + status, scoped to a specific user's listings.
   */
  async getStatusCountsForUser(userId: number) {
    const userListings = await this.prisma.listing.findMany({
      where: { userId },
      select: { id: true },
    });
    const listingIds = userListings.map((l) => l.id);
    if (listingIds.length === 0) return [];
    return this.prisma.syncLog.groupBy({
      by: ['target', 'status'],
      where: { listingId: { in: listingIds } },
      _count: { id: true },
      orderBy: [{ target: 'asc' }, { status: 'asc' }],
    });
  }

  /**
   * Most-recent failed logs for a specific user's listings, newest first.
   */
  async getRecentFailuresForUser(userId: number, limit = 50) {
    const userListings = await this.prisma.listing.findMany({
      where: { userId },
      select: { id: true },
    });
    const listingIds = userListings.map((l) => l.id);
    if (listingIds.length === 0) return [];
    return this.prisma.syncLog.findMany({
      where: { status: 'failed', listingId: { in: listingIds } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        listing: {
          select: { id: true, propertyId: true, listingableType: true, status: true },
        },
      },
    });
  }

  async findById(id: bigint | number): Promise<SyncLog | null> {
    return this.prisma.syncLog.findUnique({ where: { id: BigInt(id) } });
  }

  // ── Dashboard queries ───────────────────────────────────────────────────

  /**
   * Paginated sync dashboard: each row is a listing with its latest sync
   * status per target (portal-a, portal-b).
   */
  async getDashboard(options: {
    page: number;
    limit: number;
    search?: string;
    status?: string;      // 'success' | 'failed' | 'pending' | 'not_synced'
    platform?: string;    // 'portal-a' | 'portal-b'
    userId?: number;      // scope to agent's listings
  }) {
    const { page, limit, search, status, platform, userId } = options;
    const targets: string[] = ['portal-a', 'portal-b'];

    // Build the listing where clause
    const listingWhere: Prisma.ListingWhereInput = {};
    if (userId) {
      listingWhere.userId = userId;
    }
    if (search) {
      listingWhere.OR = [
        { propertyId: { contains: search } },
      ];
    }

    // If filtering by sync status, we need to find listings matching that status
    if (status) {
      const filterTargets = platform ? [platform] : targets;

      if (status === 'not_synced') {
        // Find listings that have NO sync logs for the specified platform(s)
        const listingsWithLogs = await this.prisma.syncLog.findMany({
          where: { target: { in: filterTargets } },
          select: { listingId: true },
          distinct: ['listingId'],
        });
        const idsWithLogs = listingsWithLogs.map((l) => l.listingId);
        listingWhere.id = { notIn: idsWithLogs.length > 0 ? idsWithLogs : [BigInt(-1)] };
      } else {
        // Find listings whose LATEST log for any of the filter targets matches the status
        const matchingIds = await this.getListingIdsByLatestStatus(
          status,
          filterTargets,
          userId,
        );
        if (matchingIds.length === 0) {
          return { data: [], meta: { total: 0, page, limit } };
        }
        listingWhere.id = { in: matchingIds };
      }
    }

    // Get total count and paginated listings
    const [total, listings] = await Promise.all([
      this.prisma.listing.count({ where: listingWhere }),
      this.prisma.listing.findMany({
        where: listingWhere,
        select: {
          id: true,
          propertyId: true,
          listingableType: true,
          status: true,
          category: true,
          userId: true,
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    if (listings.length === 0) {
      return { data: [], meta: { total, page, limit } };
    }

    const listingIds = listings.map((l) => l.id);

    // Get listing names from translations
    const translations = await this.prisma.translation.findMany({
      where: {
        translatableType: 'App\\Models\\Listing',
        translatableId: { in: listingIds },
        lang: 'en',
      },
      select: {
        translatableId: true,
        title: true,
      },
    });
    const titleMap = new Map<string, string>();
    for (const t of translations) {
      titleMap.set(String(t.translatableId), t.title ?? '');
    }

    // Get the latest sync log per listing per target
    const syncLogs = await this.prisma.syncLog.findMany({
      where: {
        listingId: { in: listingIds },
        target: { in: targets },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        listingId: true,
        target: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        externalId: true,
      },
    });

    // Build a map: listingId -> target -> latest log
    const logMap = new Map<string, Map<string, typeof syncLogs[0]>>();
    for (const log of syncLogs) {
      const key = String(log.listingId);
      if (!logMap.has(key)) logMap.set(key, new Map());
      const targetMap = logMap.get(key)!;
      // First entry per target is the latest (ordered by createdAt desc)
      if (!targetMap.has(log.target)) {
        targetMap.set(log.target, log);
      }
    }

    // Build response rows
    const data = listings.map((listing) => {
      const lid = String(listing.id);
      const targetMap = logMap.get(lid);

      const buildTargetStatus = (target: string) => {
        const log = targetMap?.get(target);
        if (!log) {
          return {
            status: 'not_synced' as const,
            lastSyncedAt: null,
            errorMessage: null,
            syncLogId: null,
          };
        }
        return {
          status: log.status,
          lastSyncedAt: log.createdAt,
          errorMessage: log.errorMessage,
          syncLogId: String(log.id),
        };
      };

      return {
        id: String(listing.id),
        propertyId: listing.propertyId,
        name: titleMap.get(lid) || `Listing #${listing.propertyId || lid}`,
        listingableType: listing.listingableType,
        listingStatus: listing.status,
        category: listing.category,
        portalA: buildTargetStatus('portal-a'),
        portalB: buildTargetStatus('portal-b'),
      };
    });

    return { data, meta: { total, page, limit } };
  }

  /**
   * Summary stats for the dashboard cards.
   */
  async getDashboardSummary(userId?: number) {
    const targets: string[] = ['portal-a', 'portal-b'];

    // Total listings
    const listingWhere: Prisma.ListingWhereInput = userId ? { userId } : {};
    const totalListings = await this.prisma.listing.count({ where: listingWhere });

    // Get all listing IDs
    const allListings = await this.prisma.listing.findMany({
      where: listingWhere,
      select: { id: true },
    });
    const allIds = allListings.map((l) => l.id);

    if (allIds.length === 0) {
      return {
        totalListings: 0,
        syncedBoth: 0,
        syncedPortalA: 0,
        syncedPortalB: 0,
        failed: 0,
        pending: 0,
        notSynced: 0,
      };
    }

    // Get latest log per listing per target
    const syncLogs = await this.prisma.syncLog.findMany({
      where: {
        listingId: { in: allIds },
        target: { in: targets },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        listingId: true,
        target: true,
        status: true,
      },
    });

    // Build latest status map
    const latestStatus = new Map<string, string>(); // "listingId:target" -> status
    for (const log of syncLogs) {
      const key = `${log.listingId}:${log.target}`;
      if (!latestStatus.has(key)) {
        latestStatus.set(key, log.status);
      }
    }

    let syncedBoth = 0;
    let syncedPortalA = 0;
    let syncedPortalB = 0;
    let failed = 0;
    let pending = 0;
    let notSynced = 0;

    for (const listing of allListings) {
      const portalAStatus = latestStatus.get(`${listing.id}:portal-a`) ?? 'not_synced';
      const portalBStatus = latestStatus.get(`${listing.id}:portal-b`) ?? 'not_synced';

      const portalAOk = portalAStatus === 'success';
      const portalBOk = portalBStatus === 'success';

      if (portalAOk && portalBOk) {
        syncedBoth++;
      } else if (portalAOk) {
        syncedPortalA++;
      } else if (portalBOk) {
        syncedPortalB++;
      }

      if (portalAStatus === 'failed' || portalBStatus === 'failed') {
        failed++;
      }
      if (portalAStatus === 'pending' || portalBStatus === 'pending') {
        pending++;
      }
      if (portalAStatus === 'not_synced' && portalBStatus === 'not_synced') {
        notSynced++;
      }
    }

    return {
      totalListings,
      syncedBoth,
      syncedPortalA,
      syncedPortalB,
      failed,
      pending,
      notSynced,
    };
  }

  /**
   * Get all failed sync log IDs (latest per listing+target) for bulk retry.
   */
  async getFailedSyncLogIds(userId?: number): Promise<Array<{ id: bigint; listingId: bigint; target: string; action: string }>> {
    const listingWhere: Prisma.ListingWhereInput = userId ? { userId } : {};
    const allListings = await this.prisma.listing.findMany({
      where: listingWhere,
      select: { id: true },
    });
    const allIds = allListings.map((l) => l.id);
    if (allIds.length === 0) return [];

    const targets = ['portal-a', 'portal-b'];
    const syncLogs = await this.prisma.syncLog.findMany({
      where: {
        listingId: { in: allIds },
        target: { in: targets },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        listingId: true,
        target: true,
        action: true,
        status: true,
      },
    });

    // Find latest log per listing+target, keep only failed ones
    const seen = new Set<string>();
    const failedLogs: Array<{ id: bigint; listingId: bigint; target: string; action: string }> = [];

    for (const log of syncLogs) {
      const key = `${log.listingId}:${log.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (log.status === 'failed') {
        failedLogs.push({
          id: log.id,
          listingId: log.listingId,
          target: log.target,
          action: log.action,
        });
      }
    }

    return failedLogs;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async createLog(data: CreateSyncLogDto): Promise<SyncLog> {
    return this.prisma.syncLog.create({
      data: {
        listingId: BigInt(data.listingId),
        target: data.target,
        action: data.action,
        status: data.status,
        externalId: data.externalId,
        requestBody: data.requestBody,
        responseBody: data.responseBody,
        errorMessage: data.errorMessage,
      },
    });
  }

  async updateLog(id: bigint | number, data: UpdateSyncLogDto): Promise<SyncLog> {
    return this.prisma.syncLog.update({ where: { id: BigInt(id) }, data });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Get listing IDs whose latest sync log for the given targets matches the status.
   */
  private async getListingIdsByLatestStatus(
    status: string,
    targets: string[],
    userId?: number,
  ): Promise<bigint[]> {
    const listingWhere: Prisma.ListingWhereInput = userId ? { userId } : {};
    const allListings = await this.prisma.listing.findMany({
      where: listingWhere,
      select: { id: true },
    });
    const allIds = allListings.map((l) => l.id);
    if (allIds.length === 0) return [];

    const syncLogs = await this.prisma.syncLog.findMany({
      where: {
        listingId: { in: allIds },
        target: { in: targets },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        listingId: true,
        target: true,
        status: true,
      },
    });

    // Find latest status per listing+target
    const latestStatus = new Map<string, Map<string, string>>();
    for (const log of syncLogs) {
      const lid = String(log.listingId);
      if (!latestStatus.has(lid)) latestStatus.set(lid, new Map());
      const targetMap = latestStatus.get(lid)!;
      if (!targetMap.has(log.target)) {
        targetMap.set(log.target, log.status);
      }
    }

    // Filter listings that match the status for any of the targets
    const matchingIds: bigint[] = [];
    for (const listing of allListings) {
      const lid = String(listing.id);
      const targetMap = latestStatus.get(lid);
      for (const target of targets) {
        const latestSt = targetMap?.get(target) ?? 'not_synced';
        if (latestSt === status) {
          matchingIds.push(listing.id);
          break;
        }
      }
    }

    return matchingIds;
  }
}
