import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Centralized security service using Redis for:
 * - IP-based rate limiting with sliding windows
 * - Login brute-force tracking (per-email)
 * - JWT blacklisting on logout
 * - Bot detection scoring
 * - Security event logging
 */
@Injectable()
export class SecurityService implements OnModuleDestroy {
  private readonly logger = new Logger('Security');
  private readonly redis: Redis;
  private readonly isDev: boolean;

  /** Known legitimate crawler User-Agent substrings */
  private static readonly LEGIT_CRAWLERS = [
    'googlebot',
    'bingbot',
    'slurp',        // Yahoo
    'duckduckbot',
    'baiduspider',
    'yandexbot',
    'facebot',      // Facebook
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegrambot',
    'applebot',
    'petalbot',     // Huawei
  ];

  /** Suspicious bot User-Agent patterns */
  private static readonly SUSPICIOUS_UA = [
    'python-requests',
    'python-urllib',
    'scrapy',
    'httpclient',
    'java/',
    'go-http-client',
    'wget',
    'curl/',
    'php/',
    'libwww',
    'lwp-trivial',
    'mechanize',
    'aiohttp',
    'httpx',
    'node-fetch',
    'undici',
    'headlesschrome',
    'phantomjs',
    'selenium',
    'puppeteer',
    'playwright',
    'crawler',
    'spider',
    'scraper',
    'harvest',
    'extract',
    'collect',
  ];

  constructor(private readonly config: ConfigService) {
    this.isDev = config.get('NODE_ENV') !== 'production';
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
      keyPrefix: 'app:sec:',
    });
    this.redis.on('error', (err: Error) =>
      this.logger.error(`Security Redis error: ${err.message}`),
    );
  }

  // ─── Rate Limiting ───────────────────────────────────────────────────────────

  /**
   * Sliding-window rate limiter.
   * Returns { allowed, remaining, retryAfterSeconds }.
   */
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
    try {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const windowStart = now - windowMs;
      const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now.toString(), member);
      pipeline.zcard(key);
      pipeline.expire(key, windowSeconds + 1);
      const results = await pipeline.exec();

      const count = (results?.[2]?.[1] as number) ?? 0;
      const allowed = count <= maxRequests;
      const remaining = Math.max(0, maxRequests - count);

      // If not allowed, calculate when the oldest entry in window expires
      let retryAfterSeconds = 0;
      if (!allowed) {
        const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
        if (oldest.length >= 2) {
          const oldestTime = parseInt(oldest[1], 10);
          retryAfterSeconds = Math.ceil((oldestTime + windowMs - now) / 1000);
          if (retryAfterSeconds < 1) retryAfterSeconds = 1;
        }
      }

      return { allowed, remaining, retryAfterSeconds };
    } catch (err) {
      this.logger.warn(`Rate limit check failed for "${key}": ${err}`);
      // Fail open — don't block requests if Redis is down
      return { allowed: true, remaining: maxRequests, retryAfterSeconds: 0 };
    }
  }

  // ─── Login Brute-Force Protection ────────────────────────────────────────────

  /**
   * Track failed login attempts per email.
   * Returns true if the account should be temporarily locked.
   */
  async recordFailedLogin(email: string): Promise<{ locked: boolean; attemptsLeft: number }> {
    const key = `login:fail:${email.toLowerCase()}`;
    const maxAttempts = 5;
    const lockoutSeconds = 900; // 15 minutes

    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, lockoutSeconds);
      }
      const locked = count >= maxAttempts;
      if (locked) {
        this.logger.warn(`Login lockout triggered for email: ${email} after ${count} failed attempts`);
      }
      return { locked, attemptsLeft: Math.max(0, maxAttempts - count) };
    } catch {
      return { locked: false, attemptsLeft: maxAttempts };
    }
  }

  async isLoginLocked(email: string): Promise<boolean> {
    try {
      const key = `login:fail:${email.toLowerCase()}`;
      const count = await this.redis.get(key);
      return count !== null && parseInt(count, 10) >= 5;
    } catch {
      return false;
    }
  }

  async clearFailedLogins(email: string): Promise<void> {
    try {
      await this.redis.del(`login:fail:${email.toLowerCase()}`);
    } catch {
      // ignore
    }
  }

  // ─── JWT Blacklisting ────────────────────────────────────────────────────────

  async blacklistToken(token: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(`jwt:bl:${token}`, '1', 'EX', ttlSeconds);
    } catch {
      this.logger.warn('Failed to blacklist JWT token');
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const result = await this.redis.get(`jwt:bl:${token}`);
      return result !== null;
    } catch {
      return false;
    }
  }

  // ─── Bot Detection ───────────────────────────────────────────────────────────

  /**
   * Calculate a suspicion score for the request (0 = legit, higher = more suspicious).
   * Returns { score, isLegitCrawler, reasons }.
   */
  analyzeRequest(headers: Record<string, string | undefined>): {
    score: number;
    isLegitCrawler: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let score = 0;
    const ua = (headers['user-agent'] || '').toLowerCase();

    // Check if it's a known legitimate crawler
    const isLegitCrawler = SecurityService.LEGIT_CRAWLERS.some((bot) =>
      ua.includes(bot),
    );
    if (isLegitCrawler) {
      return { score: 0, isLegitCrawler: true, reasons: [] };
    }

    // No User-Agent at all
    if (!ua) {
      score += 3;
      reasons.push('missing-ua');
    }

    // Suspicious UA patterns
    const suspiciousMatch = SecurityService.SUSPICIOUS_UA.find((pat) =>
      ua.includes(pat),
    );
    if (suspiciousMatch) {
      score += 4;
      reasons.push(`suspicious-ua:${suspiciousMatch}`);
    }

    // No Accept-Language header (browsers always send this)
    if (!headers['accept-language']) {
      score += 2;
      reasons.push('missing-accept-language');
    }

    // No Accept header or generic accept
    const accept = headers['accept'] || '';
    if (!accept) {
      score += 1;
      reasons.push('missing-accept');
    }

    // No Referer on non-API direct access (legitimate browse has referer)
    // This is a soft signal, not blocking

    return { score, isLegitCrawler: false, reasons };
  }

  // ─── Rapid Pagination Detection ──────────────────────────────────────────────

  /**
   * Track sequential page access to detect scraping patterns.
   * If an IP hits pages 1,2,3,4,5... in rapid succession, flag it.
   */
  async trackPagination(ip: string, page: number): Promise<{ suspicious: boolean }> {
    const key = `pag:${ip}`;
    const windowSeconds = 60;

    try {
      const now = Date.now();
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, now - windowSeconds * 1000);
      pipeline.zadd(key, now.toString(), `${page}:${now}`);
      pipeline.zcard(key);
      pipeline.expire(key, windowSeconds + 1);
      const results = await pipeline.exec();

      const pagesInWindow = (results?.[2]?.[1] as number) ?? 0;

      // More than 15 different page requests in 60 seconds = suspicious
      if (pagesInWindow > 15) {
        this.logger.warn(`Rapid pagination detected from IP ${ip}: ${pagesInWindow} pages in ${windowSeconds}s`);
        return { suspicious: true };
      }
      return { suspicious: false };
    } catch {
      return { suspicious: false };
    }
  }

  // ─── Security Logging ────────────────────────────────────────────────────────

  logSecurityEvent(
    event: string,
    details: Record<string, unknown>,
  ): void {
    this.logger.warn(
      `[SECURITY] ${event} | ${JSON.stringify(details)}`,
    );
  }

  // ─── Admin Origin Verification ───────────────────────────────────────────────

  isAllowedAdminOrigin(origin: string | undefined): boolean {
    if (this.isDev) return true;
    if (!origin) return false;
    const adminUrl = this.config.get<string>('ADMIN_URL');
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    return origin === adminUrl || origin === frontendUrl;
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
