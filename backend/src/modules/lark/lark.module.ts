import { Module } from '@nestjs/common';
import { LarkAuthService } from './lark-auth.service';
import { LarkBaseService } from './lark-base.service';
import { LarkListingService } from './lark-listing.service';
import { LarkContactService } from './lark-contact.service';

@Module({
  providers: [LarkAuthService, LarkBaseService, LarkListingService, LarkContactService],
  exports: [LarkListingService, LarkContactService],
})
export class LarkModule {}
