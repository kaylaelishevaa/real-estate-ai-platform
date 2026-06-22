import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseListing, getListing, updateListing, deleteListing, ApiError } from './api';

/** Build a fetch-style Response with optional JSON body. */
function res(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Response;
}

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('unwraps the { success, data } envelope', async () => {
    mockFetch.mockResolvedValue(res(201, { success: true, data: { status: 'written' } }));
    const out = await parseListing('Jual apartemen');
    expect(out).toEqual({ status: 'written' });
  });

  it('sends parseListing as a POST with the text in the body', async () => {
    mockFetch.mockResolvedValue(res(201, { success: true, data: {} }));
    await parseListing('hello');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/listings\/parse$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ text: 'hello' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends updateListing as a PATCH with the patch body and encoded id', async () => {
    mockFetch.mockResolvedValue(res(200, { success: true, data: { id: 'x' } }));
    await updateListing('pakubuwonoview:15a', { kondisi: 'Unfurnished' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/listings\/pakubuwonoview%3A15a$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ kondisi: 'Unfurnished' });
  });

  it('throws ApiError with the server message on a non-2xx response', async () => {
    mockFetch.mockResolvedValue(res(404, { message: 'Listing "x" not found' }));
    await expect(getListing('x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Listing "x" not found',
    });
  });

  it('joins an array validation message', async () => {
    mockFetch.mockResolvedValue(res(400, { message: ['text should not be empty', 'too long'] }));
    await expect(parseListing('')).rejects.toMatchObject({
      status: 400,
      message: 'text should not be empty, too long',
    });
  });

  it('falls back to a generic message when the error body has none', async () => {
    mockFetch.mockResolvedValue(res(500));
    await expect(getListing('x')).rejects.toMatchObject({ status: 500, message: 'Request failed (500)' });
  });

  it('surfaces a network failure as ApiError status 0', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await getListing('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it('deleteListing resolves on 204 (no body) and issues a DELETE', async () => {
    mockFetch.mockResolvedValue(res(204)); // json() throws → must not reject
    await expect(deleteListing('pakubuwonoview:15a')).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/listings\/pakubuwonoview%3A15a$/);
    expect(init.method).toBe('DELETE');
  });

  it('deleteListing throws ApiError when the server rejects', async () => {
    mockFetch.mockResolvedValue(res(404, { message: 'not found' }));
    await expect(deleteListing('nope')).rejects.toMatchObject({ status: 404, message: 'not found' });
  });
});
