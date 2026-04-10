import { SetMetadata } from '@nestjs/common';

export const CACHE_HEADER_KEY = 'cache-control-header';

/**
 * Decorator to set Cache-Control response header on public GET endpoints.
 * Usage: @CacheHeader('public, s-maxage=3600, stale-while-revalidate=300')
 */
export const CacheHeader = (value: string) =>
  SetMetadata(CACHE_HEADER_KEY, value);
