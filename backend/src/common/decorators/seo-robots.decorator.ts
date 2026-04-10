import { SetMetadata } from '@nestjs/common';

export const SEO_ROBOTS_KEY = 'x-robots-tag';

/**
 * Decorator to set X-Robots-Tag response header.
 * Usage: @SeoRobots('noindex, follow')
 */
export const SeoRobots = (value: string) =>
  SetMetadata(SEO_ROBOTS_KEY, value);
