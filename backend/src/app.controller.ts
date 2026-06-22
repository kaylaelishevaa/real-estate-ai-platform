import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CacheService } from './common/services/cache.service';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * GET /api/health
 *
 * Liveness + readiness probe used by Docker HEALTHCHECK and load balancers.
 *
 * Checks:
 *   - MySQL: SELECT 1 (fails fast if DB is unreachable)
 *   - Redis:      PING     (reported as 'degraded' but does NOT fail the probe,
 *                           because the app still serves requests when Redis is
 *                           down — caching simply falls back to DB on every hit)
 *
 * Response shapes:
 *   200 { status: 'ok',       db: 'ok', redis: 'ok'       }  — fully healthy
 *   200 { status: 'degraded', db: 'ok', redis: 'degraded' }  — Redis down
 *   503                                                        — DB down
 */
@SkipThrottle()
@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get('health')
  async health() {
    // ── Database ───────────────────────────────────────────────────────────
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'unreachable',
        message: 'Database health check failed',
      });
    }

    // ── Redis ──────────────────────────────────────────────────────────────
    const redisOk = await this.cache.ping();

    return {
      status: redisOk ? 'ok' : 'degraded',
      db: 'ok',
      redis: redisOk ? 'ok' : 'degraded',
    };
  }

  /**
   * GET /api/health/live — lightweight LIVENESS probe.
   *
   * Touches no infrastructure: returns 200 as long as the process is up. Point a
   * platform health check (e.g. Railway `healthcheckPath`) here for the
   * deterministic demo deploy, which runs the fake LLM with NO database. The full
   * `/api/health` above stays the readiness probe for a real deployment.
   */
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }
}
