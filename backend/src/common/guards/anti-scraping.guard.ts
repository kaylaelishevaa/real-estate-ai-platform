import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SecurityService } from '../services/security.service';

/**
 * Maximum allowed page size for public listing endpoints.
 * Prevents scrapers from pulling entire dataset in few requests.
 */
export const MAX_PUBLIC_PAGE_SIZE = 50;

/**
 * Decorator: override the default public rate limit for a route.
 * Usage: @PublicRateLimit(30, 60) → 30 requests per 60 seconds
 */
export const PUBLIC_RATE_LIMIT_KEY = 'public_rate_limit';
import { SetMetadata } from '@nestjs/common';
export const PublicRateLimit = (limit: number, windowSeconds: number) =>
  SetMetadata(PUBLIC_RATE_LIMIT_KEY, { limit, windowSeconds });

/**
 * Guard applied to public-facing endpoints to detect and throttle scrapers.
 *
 * Layers:
 * 1. Bot suspicion scoring (UA, headers)
 * 2. IP-based sliding-window rate limiting (stricter for suspicious requests)
 * 3. Rapid pagination detection
 * 4. Page size capping
 *
 * Legitimate crawlers (Googlebot, Bingbot, etc.) are allowed through.
 * In development mode, limits are relaxed (4x multiplier).
 */
@Injectable()
export class AntiScrapingGuard implements CanActivate {
  constructor(
    private readonly security: SecurityService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();
    const response = context.switchToHttp().getResponse<any>();
    const ip: string = request.ip || request.socket?.remoteAddress || 'unknown';
    const isDev = process.env.NODE_ENV !== 'production';
    const devMultiplier = isDev ? 4 : 1;

    // ── 1. Bot analysis ────────────────────────────────────────────────────
    const analysis = this.security.analyzeRequest(request.headers);

    // Let legitimate search engine crawlers through without rate limiting
    if (analysis.isLegitCrawler) {
      return true;
    }

    // ── 2. Cap page size ───────────────────────────────────────────────────
    const query = request.query || {};
    const requestedSize = parseInt(query.load || query.per_page || '0', 10);
    if (requestedSize > MAX_PUBLIC_PAGE_SIZE) {
      query.load = String(MAX_PUBLIC_PAGE_SIZE);
      query.per_page = String(MAX_PUBLIC_PAGE_SIZE);
    }

    // ── 3. IP-based rate limiting ──────────────────────────────────────────
    // Check for per-route overrides
    const customLimit = this.reflector.get<{ limit: number; windowSeconds: number }>(
      PUBLIC_RATE_LIMIT_KEY,
      context.getHandler(),
    );

    let maxRequests: number;
    let windowSeconds: number;

    if (customLimit) {
      maxRequests = customLimit.limit * devMultiplier;
      windowSeconds = customLimit.windowSeconds;
    } else if (analysis.score >= 3) {
      // Suspicious requests get stricter limits
      maxRequests = 15 * devMultiplier;
      windowSeconds = 60;
    } else {
      // Normal public traffic
      maxRequests = 40 * devMultiplier;
      windowSeconds = 60;
    }

    const ratePath = request.routeOptions?.url || request.url?.split('?')[0] || '/';
    const rateKey = `pub:${ip}:${ratePath}`;
    const rateResult = await this.security.checkRateLimit(rateKey, maxRequests, windowSeconds);

    // Set rate-limit headers
    if (response.header) {
      response.header('X-RateLimit-Limit', String(maxRequests));
      response.header('X-RateLimit-Remaining', String(rateResult.remaining));
    }

    if (!rateResult.allowed) {
      this.security.logSecurityEvent('RATE_LIMIT_PUBLIC', {
        ip,
        path: ratePath,
        score: analysis.score,
        reasons: analysis.reasons,
      });

      if (response.header) {
        response.header('Retry-After', String(rateResult.retryAfterSeconds));
      }
      throw new HttpException(
        'Too many requests. Please slow down.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── 4. Block highly suspicious requests ────────────────────────────────
    if (analysis.score >= 6 && !isDev) {
      this.security.logSecurityEvent('BOT_BLOCKED', {
        ip,
        path: ratePath,
        score: analysis.score,
        reasons: analysis.reasons,
        ua: request.headers['user-agent'],
      });
      throw new HttpException(
        'Request blocked.',
        HttpStatus.FORBIDDEN,
      );
    }

    // ── 5. Rapid pagination detection ──────────────────────────────────────
    const page = parseInt(query.page || '0', 10);
    if (page > 0) {
      const pagResult = await this.security.trackPagination(ip, page);
      if (pagResult.suspicious && !isDev) {
        this.security.logSecurityEvent('RAPID_PAGINATION', {
          ip,
          path: ratePath,
          page,
        });
        throw new HttpException(
          'Too many requests. Please slow down.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }
}
