import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { CacheService } from '../services/cache.service';

/**
 * Interceptor that invalidates relevant Redis cache keys after any
 * successful admin mutation (POST, PUT, PATCH, DELETE).
 *
 * Applied globally to admin routes. GET requests are skipped.
 *
 * The invalidation is "broad but safe": when an admin mutates listings,
 * we clear all listing-related caches. This keeps the logic simple and
 * avoids stale data at the cost of a few extra cache misses.
 */
@Injectable()
export class CacheInvalidationInterceptor {
  private readonly logger = new Logger(CacheInvalidationInterceptor.name);

  constructor(private readonly cache: CacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method: string = (req.method ?? '').toUpperCase();

    // Only intercept mutations
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const url: string = req.url ?? '';

    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget: don't slow down the response
        this.invalidateForUrl(url).catch((err) =>
          this.logger.warn(`Cache invalidation failed: ${err}`),
        );
      }),
    );
  }

  private async invalidateForUrl(url: string): Promise<void> {
    // Map URL prefixes to cache key patterns
    const rules: Array<{ match: RegExp; patterns: string[] }> = [
      {
        match: /\/admin\/settings/,
        patterns: ['app:settings:*'],
      },
      {
        match: /\/admin\/locations/,
        patterns: ['app:locations:*', 'app:listings:location:*'],
      },
      {
        match: /\/admin\/apartments/,
        patterns: ['app:apartments:*', 'app:listings:*', 'app:cluster:*'],
      },
      {
        match: /\/admin\/listings/,
        patterns: ['app:listings:*', 'app:cluster:*', 'app:apartments:*'],
      },
      {
        match: /\/admin\/office-buildings/,
        patterns: ['app:listings:*', 'app:cluster:*'],
      },
      {
        match: /\/admin\/blogs/,
        patterns: ['app:blogs:*'],
      },
      {
        match: /\/admin\/new-projects/,
        patterns: ['app:listings:*'],
      },
      {
        match: /\/admin\/banks/,
        patterns: ['app:banks:*'],
      },
      {
        match: /\/admin\/mortgages/,
        patterns: ['app:mortgages:*'],
      },
      {
        match: /\/admin\/reviews/,
        patterns: ['app:apartments:*'],
      },
      {
        match: /\/admin\/taxonomies/,
        patterns: ['app:blogs:*', 'app:mortgages:*'],
      },
    ];

    const patternsToInvalidate = new Set<string>();
    for (const rule of rules) {
      if (rule.match.test(url)) {
        for (const p of rule.patterns) patternsToInvalidate.add(p);
      }
    }

    if (patternsToInvalidate.size === 0) return;

    const promises = [...patternsToInvalidate].map((p) =>
      this.cache.delByPattern(p),
    );
    const results = await Promise.all(promises);
    const total = results.reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      this.logger.log(
        `Invalidated ${total} cache keys for ${url} (patterns: ${[...patternsToInvalidate].join(', ')})`,
      );
    }
  }
}
