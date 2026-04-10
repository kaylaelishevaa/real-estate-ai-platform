import { Injectable, PipeTransform } from '@nestjs/common';

/**
 * Strips empty-string query params before they reach ValidationPipe.
 * Fixes: frontend sends ?load=&page= which causes @Min() to fail on NaN.
 */
@Injectable()
export class StripEmptyStringsPipe implements PipeTransform {
  transform(value: unknown) {
    if (typeof value === 'object' && value !== null) {
      const cleaned = { ...value } as Record<string, unknown>;
      for (const key of Object.keys(cleaned)) {
        if (cleaned[key] === '') {
          delete cleaned[key];
        }
      }
      return cleaned;
    }
    return value;
  }
}
