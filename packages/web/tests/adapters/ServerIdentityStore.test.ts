/**
 * `ServerIdentityStore` — which `/me` route each `IdentityStore` method calls.
 * `fetch` is a double, so this pins the mapping; `tests/live/ServerIdentityStore.test.ts`
 * proves the server answers it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/adapters/http/ApiClient';
import { ApiError } from '../../src/adapters/http/ApiError';
import { ServerIdentityStore } from '../../src/adapters/identity/ServerIdentityStore';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let identity: ServerIdentityStore;

beforeEach(() => {
  fetchMock = vi.fn();
  identity = new ServerIdentityStore(
    new ApiClient({ baseUrl: '/api', fetch: fetchMock, readCsrfToken: () => 't' }),
  );
});

function call(n = 0): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return {
    url,
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

describe('ServerIdentityStore', () => {
  it('get() reads GET /me and returns the token', async () => {
    fetchMock.mockResolvedValue(json(200, { token: 'tok-abc' }));
    await expect(identity.get()).resolves.toBe('tok-abc');
    expect(call()).toEqual({ url: '/api/me', method: 'GET', body: undefined });
  });

  it('get() resolves null for an unrecognised browser', async () => {
    fetchMock.mockResolvedValue(json(200, { token: null }));
    await expect(identity.get()).resolves.toBeNull();
  });

  it('set(token) sends PUT /me with only the token', async () => {
    fetchMock.mockResolvedValue(json(200, { token: 'tok-abc' }));
    await identity.set('tok-abc');
    expect(call()).toEqual({ url: '/api/me', method: 'PUT', body: { token: 'tok-abc' } });
  });

  it('clear() sends DELETE /me', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await identity.clear();
    expect(call()).toEqual({ url: '/api/me', method: 'DELETE', body: undefined });
  });

  it('lets a failure throw as an ApiError', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    await expect(identity.get()).rejects.toBeInstanceOf(ApiError);
  });
});
