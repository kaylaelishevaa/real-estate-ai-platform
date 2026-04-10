import { Global, Module } from '@nestjs/common';
import { ClusterQueryService } from './services/cluster-query.service';
import { ListingService } from './services/listing.service';
import { PolymorphicService } from './services/polymorphic.service';
import { CacheService } from './services/cache.service';
import { SecurityService } from './services/security.service';

@Global()
@Module({
  providers: [
    PolymorphicService,
    ListingService,
    ClusterQueryService,
    CacheService,
    SecurityService,
  ],
  exports: [
    PolymorphicService,
    ListingService,
    ClusterQueryService,
    CacheService,
    SecurityService,
  ],
})
export class CommonModule {}
