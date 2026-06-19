import { Controller, Get, Post, Body, Query, Logger, HttpCode } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { filterInbound, type InboundMessage } from '../../core';
import { WhatsAppService } from './whatsapp.service';
import type { WaListingJob } from './wa-listing.processor';

/**
 * Meta WhatsApp Business Cloud webhook.
 *
 * The important part is the fail-closed whitelist: Meta delivers every event
 * type to this one endpoint (text, image, audio, location, sticker, reactions,
 * system notices, future types). We enqueue ONLY explicitly-allowed types and
 * reject the rest — the fix for the phantom-record bug where an unhandled type
 * (e.g. a shared location) used to advance a conversation and create an empty
 * listing. See `core/intake/message-whitelist`.
 */
@Controller('webhook/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppService,
    @InjectQueue('whatsapp-listing') private readonly listingQueue: Queue,
  ) {}

  /** Meta webhook verification handshake. */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === this.config.get('WA_VERIFY_TOKEN')) {
      return challenge;
    }
    this.logger.warn('Webhook verification failed');
    return 'Forbidden';
  }

  @Post()
  @HttpCode(200) // must ack fast — Meta retries on non-200
  async handleIncoming(@Body() payload: any): Promise<string> {
    const messages = payload?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

    for (const raw of messages) {
      const inbound: InboundMessage = {
        type: raw?.type,
        from: raw?.from,
        text: raw?.text?.body,
        mediaId: raw?.image?.id,
        timestamp: raw?.timestamp,
      };

      const gate = filterInbound(inbound);
      if (!gate.accepted) {
        this.logger.log(`Dropped inbound from ${inbound.from}: ${gate.reason}`);
        continue; // fail closed — never enqueue an unrecognized type
      }
      if (gate.type !== 'text') {
        // Images attach to an existing draft in the full system; out of scope here.
        continue;
      }

      const job: WaListingJob = {
        from: gate.message.from,
        roomId: gate.message.from,
        text: gate.message.text!,
        timestamp: gate.message.timestamp,
      };
      await this.listingQueue.add('process', job);
    }

    return 'OK'; // always 200
  }
}
