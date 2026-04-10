import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SecurityService } from '../services/security.service';

/**
 * Maximum allowed page size for public listing endpoints.
 * Prevents scrapers from pulling the entire dataset in few requests.
 */
export const MAX_PUBLIC_PAGE_SIZE = 50;

/**
 * Global guard for all public API endpoints (non-admin, non-auth).
 * Applied globally via APP_GUARD — skips admin and auth routes.
 *
 * Security layers:
 * 1. Bot suspicion scoring (UA, headers analysis)
 * 2. IP-based sliding-window rate limiting (stricter for suspicious requests)
 * 3. Rapid pagination detection
 * 4. Page size capping
 *
 * Legitimate crawlers (Googlebot, Bingbot, etc.) pass through freely for SEO.
 * Development mode relaxes all limits by 4x.
 */
@Injectable()
export class PublicApiGuard implements CanActivate {
  private readonly logger = new Logger('PublicApiGuard');

  constructor(private readonly security: SecurityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();
    const response = context.switchToHttp().getResponse<any>();

    const url: string = request.url || '';
    const method: string = request.method || 'GET';

    // Only apply to public GET endpoints (the scraping targets)
    // Skip admin routes, auth routes, webhooks, health checks
    if (method !== 'GET') return true;
    if (url.startsWith('/api/admin')) return true;
    if (url.startsWith('/api/auth')) return true;
    if (url.startsWith('/api/health')) return true;
    if (url.startsWith('/api/whatsapp')) return true;
    if (url.startsWith('/placeholder/')) return true;

    const ip: string = request.ip || request.socket?.remoteAddress || 'unknown';
    const isDev = process.env.NODE_ENV !== 'production';
    const devMultiplier = isDev ? 4 : 1;

    // ── 1. Bot analysis ────────────────────────────────────────────────────
    const analysis = this.security.analyzeRequest(request.headers);

    // Let legitimate search engine crawlers through without limits
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

    // ── 3. Block highly suspicious requests (score >= 6) ───────────────────
    if (analysis.score >= 6 && !isDev) {
      this.security.logSecurityEvent('BOT_BLOCKED', {
        ip,
        path: url,
        score: analysis.score,
        reasons: analysis.reasons,
        ua: request.headers['user-agent'],
      });
      throw new HttpException('Request blocked.', HttpStatus.FORBIDDEN);
    }

    // ── 4. IP-based rate limiting ──────────────────────────────────────────
    // Suspicious requests get stricter limits
    const maxRequests = analysis.score >= 3
      ? 20 * devMultiplier
      : 45 * devMultiplier;
    const windowSeconds = 60;

    // Rate-limit by IP across all public endpoints combined
    const rateKey = `pub:${ip}`;
    const rateResult = await this.security.checkRateLimit(rateKey, maxRequests, windowSeconds);

    // Set rate-limit headers
    if (response.header) {
      response.header('X-RateLimit-Limit', String(maxRequests));
      response.header('X-RateLimit-Remaining', String(rateResult.remaining));
    }

    if (!rateResult.allowed) {
      this.security.logSecurityEvent('RATE_LIMIT_PUBLIC', {
        ip,
        path: url,
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

    // ── 5. Rapid pagination detection ──────────────────────────────────────
    const page = parseInt(query.page || '0', 10);
    if (page > 0) {
      const pagResult = await this.security.trackPagination(ip, page);
      if (pagResult.suspicious && !isDev) {
        this.security.logSecurityEvent('RAPID_PAGINATION', { ip, path: url, page });
        throw new HttpException(
          'Too many requests. Please slow down.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }
}
