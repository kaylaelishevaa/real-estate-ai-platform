import { Module } from '@nestjs/common';
import { AdminModule } from '../../common/admin.module';
import { PortalAService } from './targets/portal-a/portal-a.service';
import { PortalBService } from './targets/portal-b/portal-b.service';
import { SyncLogService } from './sync-log.service';
import { SyncService } from './sync.service';
import { SyncProcessor } from './sync.processor';
import { SyncAdminController } from './sync-admin.controller';

@Module({
  imports: [AdminModule],
  controllers: [SyncAdminController],
  providers: [
    // Target HTTP clients
    PortalAService,
    PortalBService,
    // Core sync services
    SyncLogService,
    SyncService,
    // BullMQ worker — processes 'listing-sync' jobs from the shared Redis queue.
    // The connection is provided globally by QueueModule (BullModule.forRootAsync).
    SyncProcessor,
  ],
  exports: [SyncService, SyncLogService],
})
export class SyncModule {}
