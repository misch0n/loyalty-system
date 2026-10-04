/**
 * `ApiClient.request` — the one way the SPA reaches the server.
 *
 * `fetch` is a test double here, and deliberately so: these tests pin the
 * client's own contract (headers, cookies, JSON, the failure union, what it
 * tells subscribers), which a real server cannot make fail on demand. Whether
 * the routes answer what `ApiStore` expects is the real-server harness's job
 * (UI-2, P6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  CSRF_HEADER,
  type ApiEvent,
} from '../../src/adapters/http/ApiClient';
import { ApiError, failureScope, type ApiFailure } from '../../src/adapters/http/ApiError';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('ApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let csrf: string | null;
  let api: ApiClient;
  let events: ApiEvent[];

  beforeEach(() => {
    fetchMock = vi.fn();
    csrf = 'csrf-token-value';
    api = new ApiClient({ baseUrl: '/api/', fetch: fetchMock, readCsrfToken: () => csrf });
    events = [];
    api.subscribe((event) => events.push(event));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function sent(): { url: string; init: RequestInit; headers: Record<string, string> } {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string> };
  }

  async function failure(promise: Promise<unknown>): Promise<ApiFailure> {
    const err = await promise.then(
      () => {
        throw new Error('expected the request to fail');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).failure;
  }

  describe('the request it sends', () => {
    it('sends cookies, asks for JSON and joins the base without a double slash', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
      await api.request('GET', '/config');
      const { url, init, headers } = sent();
      expect(url).toBe('/api/config');
      expect(init.credentials).toBe('include');
      expect(init.method).toBe('GET');
      expect(headers.Accept).toBe('application/json');
    });

    it('sends a JSON body with its content type', async () => {
      fetchMock.mockResolvedValueOnce(json(200, {}));
      await api.request('POST', '/customers/search', { term: 'ana' });
      const { init, headers } = sent();
      expect(headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe('{"term":"ana"}');
    });

    it('sends no content type without a body — Fastify refuses an empty JSON body', async () => {
      fetchMock.mockResolvedValueOnce(json(200, {}));
      await api.request('POST', '/customers/c1/rotate-token');
      expect(sent().headers['Content-Type']).toBeUndefined();
      expect(sent().init.body).toBeUndefined();
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
      'echoes the CSRF cookie on %s',
      async (method) => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        await api.request(method, '/x');
        expect(sent().headers[CSRF_HEADER]).toBe('csrf-token-value');
      },
    );

    it('does not send the CSRF token on a GET', async () => {
      fetchMock.mockResolvedValueOnce(json(200, {}));
      await api.request('GET', '/x');
      expect(sent().headers[CSRF_HEADER]).toBeUndefined();
    });

    it('sends no CSRF header when there is no cookie yet (signed out)', async () => {
      csrf = null;
      fetchMock.mockResolvedValueOnce(json(201, {}));
      await api.request('POST', '/customers', {});
      expect(sent().headers[CSRF_HEADER]).toBeUndefined();
    });

    it('reads the CSRF token from document.cookie by default', async () => {
      document.cookie = 'other=1';
      document.cookie = 'cafe_csrf=from%20cookie';
      const plain = new ApiClient({ baseUrl: '/api', fetch: fetchMock });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await plain.request('DELETE', '/x');
      expect(sent().headers[CSRF_HEADER]).toBe('from cookie');
      document.cookie = 'cafe_csrf=; max-age=0';
    });
  });

  describe('what it resolves', () => {
    it('resolves the parsed JSON body', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { pointsPerReward: 9 }));
      await expect(api.request('GET', '/config')).resolves.toEqual({ pointsPerReward: 9 });
    });

    it('resolves a bare JSON number', async () => {
      fetchMock.mockResolvedValueOnce(json(200, 42));
      await expect(api.request('GET', '/stats/active-customers')).resolves.toBe(42);
    });

    it('resolves undefined for a 204', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(api.request('DELETE', '/staff/s1')).resolves.toBeUndefined();
    });

    it('tells subscribers the server is reachable', async () => {
      fetchMock.mockResolvedValueOnce(json(200, {}));
      await api.request('GET', '/x');
      expect(events).toEqual([{ type: 'reachable' }]);
    });
  });

  describe('every failure, one union', () => {
    it('offline — fetch rejected', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect(await failure(api.request('GET', '/x'))).toEqual({ kind: 'offline' });
    });

    it('offline — the timeout fired', async () => {
      vi.useFakeTimers();
      const slow = new ApiClient({
        baseUrl: '/api',
        timeoutMs: 1000,
        readCsrfToken: () => null,
        fetch: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      });
      const pending = failure(slow.request('GET', '/x'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ kind: 'offline' });
    });

    it('signed_out — 401 unauthorized: the session has ended', async () => {
      fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));
      expect(await failure(api.request('GET', '/staff'))).toEqual({ kind: 'signed_out' });
    });

    it('rejected — a wrong password is a 401 but not a session failure', async () => {
      fetchMock.mockResolvedValueOnce(json(401, { error: 'invalid_credentials' }));
      expect(await failure(api.request('POST', '/auth/login', {}))).toEqual({
        kind: 'rejected',
        code: 'invalid_credentials',
      });
    });

    it.each(['forbidden', 'csrf_failed', 'forbidden_origin', 'staff_device'])(
      'forbidden — 403 %s',
      async (code) => {
        fetchMock.mockResolvedValueOnce(json(403, { error: code }));
        expect(await failure(api.request('POST', '/x', {}))).toEqual({ kind: 'forbidden', code });
      },
    );

    it('not_found — 404 carries its code', async () => {
      fetchMock.mockResolvedValueOnce(json(404, { error: 'customer_not_found' }));
      expect(await failure(api.request('GET', '/x'))).toEqual({
        kind: 'not_found',
        code: 'customer_not_found',
      });
    });

    it('rate_limited — 429 with the body’s retryAfterSec', async () => {
      fetchMock.mockResolvedValueOnce(
        json(429, { error: 'rate_limited', retryAfterSec: 42 }, { 'retry-after': '42' }),
      );
      expect(await failure(api.request('POST', '/auth/login', {}))).toEqual({
        kind: 'rate_limited',
        retryAfterSec: 42,
      });
    });

    it('rate_limited — falls back to the retry-after header', async () => {
      fetchMock.mockResolvedValueOnce(json(429, { error: 'rate_limited' }, { 'retry-after': '7' }));
      expect(await failure(api.request('POST', '/x', {}))).toEqual({
        kind: 'rate_limited',
        retryAfterSec: 7,
      });
    });

    it('rate_limited — null when the server gave no figure', async () => {
      fetchMock.mockResolvedValueOnce(json(429, { error: 'too_many_streams', limit: 4 }));
      expect(await failure(api.request('GET', '/x'))).toEqual({
        kind: 'rate_limited',
        retryAfterSec: null,
      });
    });

    it('email_in_use — its own member, because a screen answers it with recovery', async () => {
      fetchMock.mockResolvedValueOnce(json(409, { error: 'email_in_use' }));
      expect(await failure(api.request('POST', '/customers', {}))).toEqual({ kind: 'email_in_use' });
    });

    it.each(['username_taken', 'already_reversed', 'cannot_delete_self', 'cannot_disable_self'])(
      'conflict — 409 %s',
      async (code) => {
        fetchMock.mockResolvedValueOnce(json(409, { error: code }));
        expect(await failure(api.request('POST', '/x', {}))).toEqual({ kind: 'conflict', code });
      },
    );

    it.each(['invalid_details', 'invalid_request', 'invalid_code', 'range_too_wide', 'empty_patch'])(
      'rejected — 400 %s',
      async (code) => {
        fetchMock.mockResolvedValueOnce(json(400, { error: code }));
        expect(await failure(api.request('POST', '/x', {}))).toEqual({ kind: 'rejected', code });
      },
    );

    it('server — a 5xx', async () => {
      fetchMock.mockResolvedValueOnce(json(500, { error: 'internal_error' }));
      expect(await failure(api.request('GET', '/x'))).toEqual({ kind: 'server', status: 500 });
    });

    it('server — a proxy’s HTML error page', async () => {
      fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
      expect(await failure(api.request('GET', '/x'))).toEqual({ kind: 'server', status: 502 });
    });

    it('server — a 2xx that is not JSON did not come from the API', async () => {
      fetchMock.mockResolvedValueOnce(new Response('<!doctype html><div id="root">', { status: 200 }));
      expect(await failure(api.request('GET', '/x'))).toEqual({ kind: 'server', status: 200 });
    });

    it('a 4xx with no JSON body still gets a code', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }));
      expect(await failure(api.request('POST', '/x', {}))).toEqual({
        kind: 'rejected',
        code: 'unknown',
      });
    });

    it('never puts the path or the body in the error message', async () => {
      fetchMock.mockResolvedValueOnce(json(409, { error: 'email_in_use', email: 'a@b.c' }));
      const err = await api.request('POST', '/customers/by-token/SECRET', { email: 'a@b.c' }).catch((e: Error) => e);
      expect(String((err as Error).message)).not.toMatch(/SECRET|a@b\.c/);
    });
  });

  describe('what subscribers hear', () => {
    it('a refusal is still an answer: reachable, then the failure', async () => {
      fetchMock.mockResolvedValueOnce(json(404, { error: 'not_found' }));
      await api.request('GET', '/x').catch(() => undefined);
      expect(events.map((e) => e.type)).toEqual(['reachable', 'failure']);
    });

    it('a 5xx is not reachable — only the failure', async () => {
      fetchMock.mockResolvedValueOnce(json(503, {}));
      await api.request('GET', '/x').catch(() => undefined);
      expect(events.map((e) => e.type)).toEqual(['failure']);
    });

    it('stops telling a listener once it unsubscribes', async () => {
      const heard: ApiEvent[] = [];
      const off = api.subscribe((e) => heard.push(e));
      off();
      fetchMock.mockResolvedValueOnce(json(200, {}));
      await api.request('GET', '/x');
      expect(heard).toEqual([]);
    });

    it('a throwing listener does not turn a success into a failure', async () => {
      api.subscribe(() => {
        throw new Error('broken subscriber');
      });
      fetchMock.mockResolvedValueOnce(json(200, { fine: true }));
      await expect(api.request('GET', '/x')).resolves.toEqual({ fine: true });
    });
  });
});

describe('failureScope (X2 routing)', () => {
  it.each<[ApiFailure, string]>([
    [{ kind: 'signed_out' }, 'session'],
    [{ kind: 'offline' }, 'connectivity'],
    [{ kind: 'server', status: 502 }, 'connectivity'],
    [{ kind: 'forbidden', code: 'csrf_failed' }, 'action'],
    [{ kind: 'not_found', code: 'not_found' }, 'action'],
    [{ kind: 'rate_limited', retryAfterSec: 3 }, 'action'],
    [{ kind: 'email_in_use' }, 'action'],
    [{ kind: 'conflict', code: 'username_taken' }, 'action'],
    [{ kind: 'rejected', code: 'invalid_credentials' }, 'action'],
  ])('%o → %s', (failure, scope) => {
    expect(failureScope(failure)).toBe(scope);
  });
});
