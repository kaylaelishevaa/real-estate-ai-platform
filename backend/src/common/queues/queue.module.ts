import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Register both named queues in one call.
// Storing the result lets us re-export the same DynamicModule so that
// queue injection tokens are available globally via this @Global() module.
// ---------------------------------------------------------------------------
const registeredQueues = BullModule.registerQueue(
  { name: 'listing-sync' },
  { name: 'image-processing' },
  { name: 'whatsapp-listing' },
);

// NOTE: The 'listing-sync' queue is processed by SyncProcessor, which lives in
// SyncModule (src/modules/sync/sync.processor.ts). Keeping the processor there
// co-locates it with the business logic it drives.
@Global()
@Module({
  imports: [
    // Shared Redis connection — all queues registered in this module
    // will use this connection unless overridden per-queue.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
    }),
    registeredQueues,
  ],
  // Re-export the queues DynamicModule so every module in the application
  // can use @InjectQueue('listing-sync') / @InjectQueue('image-processing')
  // without importing QueueModule explicitly.
  exports: [registeredQueues],
})
export class QueueModule {}
