/** Shape of Laravel's LengthAwarePaginator JSON output. */
export interface PaginatedResult<T> {
  current_page: number;
  data: T[];
  first_page_url: string;
  from: number;
  last_page: number;
  last_page_url: string;
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number;
  total: number;
  attributes?: Record<string, unknown>;
}

/**
 * Build a Laravel-compatible pagination envelope.
 *
 * @param items   - The records for the current page (already sliced).
 * @param total   - Total count of matching records across all pages.
 * @param page    - Current page number (1-based).
 * @param perPage - Number of items per page.
 * @param path    - Base URL used to construct page URLs (no trailing slash, no query string).
 */
export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  perPage: number,
  path: string = '',
): PaginatedResult<T> {
  const lastPage = total === 0 ? 1 : Math.ceil(total / perPage);
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = total === 0 ? 0 : Math.min(page * perPage, total);

  const pageUrl = (p: number) => `${path}?page=${p}`;

  return {
    current_page: page,
    data: items,
    first_page_url: pageUrl(1),
    from,
    last_page: lastPage,
    last_page_url: pageUrl(lastPage),
    next_page_url: page < lastPage ? pageUrl(page + 1) : null,
    path,
    per_page: perPage,
    prev_page_url: page > 1 ? pageUrl(page - 1) : null,
    to,
    total,
  };
}

/**
 * Extract page / perPage from a request query-string object.
 * Supports `page`, `per_page`, and the Laravel-style `load` alias.
 *
 * Defaults: page = 1, perPage = 15.
 * Both values are clamped to a minimum of 1.
 */
export function paginateQuery(query: Record<string, unknown>): {
  page: number;
  perPage: number;
} {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.max(1, Number(query.per_page ?? query.load ?? query.limit) || 15);
  return { page, perPage };
}
