import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

/**
 * REST surface for the listing parser demo. Self-contained and in-memory —
 * depends only on `src/core`, no Prisma/Redis — so it serves with zero infra.
 */
@Module({
  controllers: [ListingsController],
  providers: [ListingsService],
})
export class ListingsModule {}
