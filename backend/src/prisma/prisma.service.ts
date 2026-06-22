import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const url = config.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Create a .env file with DATABASE_URL=mysql://...',
      );
    }
    super({ datasources: { db: { url } } });
  }

  async onModuleInit(): Promise<void> {
    // Boot-tolerant: the in-memory demo endpoints (e.g. the listings parser
    // playground) never touch the database, so a missing/unreachable DB should
    // not prevent the API from starting. DB-backed features surface the error at
    // query time instead. When a real DATABASE_URL is reachable, this connects
    // exactly as before.
    try {
      await this.$connect();
    } catch (err) {
      console.warn(
        `PrismaService: could not connect to the database — continuing without it. (${(err as Error).message})`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
