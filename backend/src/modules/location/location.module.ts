import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationSearchService } from './location-search.service';
import { LocationService } from './location.service';
import { AdminLocationController } from './admin-location.controller';
import { AdminLocationService } from './admin-location.service';
import { AdminModule } from '../../common/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [LocationController, AdminLocationController],
  providers: [LocationService, LocationSearchService, AdminLocationService],
  exports: [LocationService],
})
export class LocationModule {}
