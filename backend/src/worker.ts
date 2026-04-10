import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error', 'debug', 'verbose'],
  });

  const logger = new Logger('Worker');
  logger.log('BullMQ worker started — listening on queues: listing-sync, image-processing');

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — shutting down worker gracefully`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err: unknown) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
