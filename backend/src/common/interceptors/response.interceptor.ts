import { CallHandler, ExecutionContext, Injectable } from '@nestjs/common';
import { map, Observable } from 'rxjs';

interface ApiResponse {
  success: boolean;
  data: unknown;
  links?: unknown;
  meta?: unknown;
}

function isPaginated(
  obj: unknown,
): obj is { current_page: number; data: unknown[] } {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'current_page' in obj &&
    'data' in obj &&
    Array.isArray((obj as any).data)
  );
}

@Injectable()
export class ResponseInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse> {
    return next.handle().pipe(
      map((data: unknown): ApiResponse => {
        // Already wrapped
        if (data && typeof data === 'object' && 'success' in data) {
          return data as ApiResponse;
        }

        // Paginated → split into data + links + meta + attributes
        if (isPaginated(data)) {
          const {
            data: items,
            first_page_url,
            last_page_url,
            prev_page_url,
            next_page_url,
            attributes,
            ...meta
          } = data as Record<string, unknown> & { data: unknown[] };
          const response: Record<string, unknown> = {
            success: true,
            data: items,
            links: {
              first: first_page_url ?? null,
              last: last_page_url ?? null,
              prev: prev_page_url ?? null,
              next: next_page_url ?? null,
            },
            meta,
          };
          if (attributes !== undefined) {
            response.attributes = attributes;
          }
          return response as unknown as ApiResponse;
        }

        // Everything else → wrap as-is
        return {
          success: true,
          data,
        };
      }),
    );
  }
}
