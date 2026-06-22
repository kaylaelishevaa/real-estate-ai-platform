import type { ListingDetail, ListingSummary, ParseResult, UpdateListingPayload } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/** The backend wraps every response as { success, data }. */
interface Envelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Could not reach the API. Is the backend running?', 0);
  }

  let body: Envelope<T> | { message?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, res.status);
  }

  return (body as Envelope<T>).data;
}

export function parseListing(text: string): Promise<ParseResult> {
  return request<ParseResult>('/listings/parse', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function getListings(): Promise<ListingSummary[]> {
  return request<ListingSummary[]>('/listings');
}

export function getListing(id: string): Promise<ListingDetail> {
  return request<ListingDetail>(`/listings/${encodeURIComponent(id)}`);
}

export function updateListing(id: string, patch: UpdateListingPayload): Promise<ListingDetail> {
  return request<ListingDetail>(`/listings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** DELETE returns 204 (no body), so it doesn't go through the data-unwrapping path. */
export async function deleteListing(id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    throw new ApiError('Could not reach the API. Is the backend running?', 0);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* empty body */
    }
    throw new ApiError(message, res.status);
  }
}
