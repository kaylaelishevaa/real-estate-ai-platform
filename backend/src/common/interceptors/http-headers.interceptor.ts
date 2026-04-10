import {
  CallHandler,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { CACHE_HEADER_KEY } from '../decorators/cache-header.decorator';
import { SEO_ROBOTS_KEY } from '../decorators/seo-robots.decorator';

/**
 * Global interceptor that reads @CacheHeader() and @SeoRobots() metadata
 * and sets the corresponding response headers.
 *
 * Admin routes (/admin/*) always get `Cache-Control: private, no-store`
 * and `X-Robots-Tag: noindex, nofollow`.
 */
@Injectable()
export class HttpHeadersInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const method: string = (req.method ?? '').toUpperCase();
    const url: string = req.url ?? '';

    // Admin routes — never cache, never index
    if (url.includes('/admin/')) {
      res.header('Cache-Control', 'private, no-store');
      res.header('X-Robots-Tag', 'noindex, nofollow');
      return next.handle();
    }

    // Only apply cache headers to GET requests
    if (method === 'GET') {
      const cacheHeader = this.reflector.getAllAndOverride<string | undefined>(
        CACHE_HEADER_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (cacheHeader) {
        res.header('Cache-Control', cacheHeader);
      }

      const robotsTag = this.reflector.getAllAndOverride<string | undefined>(
        SEO_ROBOTS_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (robotsTag) {
        res.header('X-Robots-Tag', robotsTag);
      }
    }

    return next.handle();
  }
}
