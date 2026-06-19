import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { MessagingService } from './messaging.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppService } from './whatsapp.service';
import { ListingWriteService } from './listing-write.service';
import { WaListingProcessor } from './wa-listing.processor';

/**
 * WhatsApp intake module. Receives Meta webhook events, fails closed on
 * non-listing types, and runs accepted text through the slim listing worker
 * (parse → validate → write) built on the tested `src/core` units.
 */
@Module({
  imports: [AIModule],
  controllers: [WhatsAppWebhookController],
  providers: [MessagingService, WhatsAppService, ListingWriteService, WaListingProcessor],
  exports: [MessagingService],
})
export class WhatsAppModule {}
