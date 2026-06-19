import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { validate } from './common/config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { QueueModule } from './common/queues/queue.module';
import { LocationModule } from './modules/location/location.module';
import { AuthModule } from './modules/auth/auth.module';
import { AIModule } from './modules/ai/ai.module';
import { MediaModule } from './modules/media/media.module';
import { SyncModule } from './modules/sync/sync.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { LarkModule } from './modules/lark/lark.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { CacheInvalidationInterceptor } from './common/interceptors/cache-invalidation.interceptor';
import { HttpHeadersInterceptor } from './common/interceptors/http-headers.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PublicApiGuard } from './common/guards/public-api.guard';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    CommonModule,
    QueueModule,
    LocationModule,
    AuthModule,
    AIModule,
    MediaModule,
    SyncModule,
    WhatsAppModule,
    LarkModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PublicApiGuard },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInvalidationInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpHeadersInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
