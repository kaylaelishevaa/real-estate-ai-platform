import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ForbiddenException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminOnlyGuard } from '../../common/guards/admin-only.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SyncLogService } from './sync-log.service';
import { SyncService } from './sync.service';
import type { SyncTarget, SyncAction } from './sync.service';
import { PrismaService } from '../../prisma/prisma.service';

// ---------------------------------------------------------------------------

/**
 * Admin endpoints for monitoring and retrying portal sync operations.
 * All routes are protected by the AdminGuard and PermissionGuard.
 */
@Controller('admin/sync')
@UseGuards(AdminGuard, AdminOnlyGuard, PermissionGuard)
export class SyncAdminController {
  constructor(
    private readonly syncLogService: SyncLogService,
    private readonly syncService: SyncService,
    private readonly prisma: PrismaService,
  ) {}

  // ── GET /admin/sync/status ────────────────────────────────────────────────

  /**
   * Overall sync health: counts of sync log records grouped by target + status.
   */
  @Get('status')
  @RequirePermission('view_listing')
  async status(@CurrentUser() user: any) {
    const rows = user.agentScope
      ? await this.syncLogService.getStatusCountsForUser(Number(user.id))
      : await this.syncLogService.getStatusCounts();

    // Pivot the groupBy result into a nested object { target -> status -> count }
    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      result[row.target] ??= {};

      result[row.target][row.status] = (row as any)._count.id as number;
    }

    return result;
  }

  // ── GET /admin/sync/failures ──────────────────────────────────────────────

  /**
   * Most-recent 50 failed sync attempts, newest first.
   * Includes slim listing info (id, propertyId, listingableType) for context.
   */
  @Get('failures')
  @RequirePermission('view_listing')
  async failures(@CurrentUser() user: any) {
    return user.agentScope
      ? this.syncLogService.getRecentFailuresForUser(Number(user.id))
      : this.syncLogService.getRecentFailures(50);
  }

  // ── GET /admin/sync/dashboard ─────────────────────────────────────────────

  /**
   * Paginated sync dashboard: each row is a listing with sync status per platform.
   */
  @Get('dashboard')
  @RequirePermission('view_listing')
  async dashboard(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('platform') platform?: string,
  ) {
    return this.syncLogService.getDashboard({
      page: Math.max(1, parseInt(page || '1', 10)),
      limit: Math.min(100, Math.max(1, parseInt(limit || '15', 10))),
      search: search || undefined,
      status: status || undefined,
      platform: platform || undefined,
      userId: user.agentScope ? Number(user.id) : undefined,
    });
  }

  // ── GET /admin/sync/summary ───────────────────────────────────────────────

  /**
   * Summary stats for the sync dashboard cards.
   */
  @Get('summary')
  @RequirePermission('view_listing')
  async summary(@CurrentUser() user: any) {
    return this.syncLogService.getDashboardSummary(
      user.agentScope ? Number(user.id) : undefined,
    );
  }

  // ── POST /admin/sync/retry/:id ────────────────────────────────────────────

  /**
   * Retry a specific failed sync log entry.
   */
  @Post('retry/:id')
  @RequirePermission('view_listing')
  async retry(@Param('id') id: string, @CurrentUser() user: any) {
    const log = await this.syncLogService.findById(parseInt(id, 10));

    if (!log) {
      throw new NotFoundException(`SyncLog #${id} not found`);
    }

    // If agent, verify the sync log's listing belongs to them
    if (user.agentScope) {
      const listing = await this.prisma.listing.findUnique({
        where: { id: Number(log.listingId) },
        select: { userId: true },
      });
      if (!listing || Number(listing.userId) !== Number(user.id)) {
        throw new ForbiddenException('You can only retry sync for your own listings');
      }
    }

    await this.syncService.dispatchSyncForTarget(
      log.listingId,
      log.target as SyncTarget,
      log.action as SyncAction,
    );

    return {
      message: `Retry job queued for listing #${log.listingId} -> ${log.target} [${log.action}]`,
      syncLogId: log.id,
      listingId: log.listingId,
      target: log.target,
      action: log.action,
    };
  }

  // ── POST /admin/sync/retry-listing/:listingId/:target ─────────────────────

  /**
   * Retry sync for a specific listing to a specific platform.
   * Used by the dashboard retry button per-row.
   */
  @Post('retry-listing/:listingId/:target')
  @RequirePermission('view_listing')
  async retryListing(
    @Param('listingId') listingId: string,
    @Param('target') target: string,
    @CurrentUser() user: any,
  ) {
    const validTargets: SyncTarget[] = ['portal-a', 'portal-b'];
    if (!validTargets.includes(target as SyncTarget)) {
      throw new NotFoundException(`Unknown sync target: ${target}`);
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: BigInt(listingId) },
      select: { id: true, userId: true },
    });

    if (!listing) {
      throw new NotFoundException(`Listing #${listingId} not found`);
    }

    if (user.agentScope && Number(listing.userId) !== Number(user.id)) {
      throw new ForbiddenException('You can only retry sync for your own listings');
    }

    // Determine action from latest sync log or default to 'create'
    const latestLog = await this.prisma.syncLog.findFirst({
      where: { listingId: BigInt(listingId), target },
      orderBy: { createdAt: 'desc' },
      select: { action: true },
    });

    const action: SyncAction = (latestLog?.action as SyncAction) || 'create';

    await this.syncService.dispatchSyncForTarget(
      BigInt(listingId),
      target as SyncTarget,
      action,
    );

    return {
      message: `Retry job queued for listing #${listingId} -> ${target} [${action}]`,
      listingId,
      target,
      action,
    };
  }

  // ── POST /admin/sync/retry-all-failed ─────────────────────────────────────

  /**
   * Retry all listings whose latest sync status is 'failed'.
   */
  @Post('retry-all-failed')
  @RequirePermission('view_listing')
  async retryAllFailed(@CurrentUser() user: any) {
    const failedLogs = await this.syncLogService.getFailedSyncLogIds(
      user.agentScope ? Number(user.id) : undefined,
    );

    let queued = 0;
    for (const log of failedLogs) {
      await this.syncService.dispatchSyncForTarget(
        log.listingId,
        log.target as SyncTarget,
        (log.action as SyncAction) || 'create',
      );
      queued++;
    }

    return {
      message: `Queued ${queued} retry jobs for failed syncs`,
      count: queued,
    };
  }
}
