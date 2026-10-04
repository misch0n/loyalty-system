/**
 * ApiClient — the one method the whole SPA talks to the server through.
 *
 * Every call, whether `ApiStore` makes it for the `DataStore` port or a service
 * makes it for a route the port does not carry (sign-in, recovery, alerts),
 * goes through {@link ApiClient.request}, which owns four things no caller
 * should repeat:
 *
 *   - **The session travels as cookies.** `credentials: 'include'` sends the
 *     HttpOnly session cookie; nothing in script can read or forge it.
 *   - **CSRF is a double-submit.** The server also sets a deliberately
 *     script-readable `cafe_csrf` cookie, and every mutating request echoes it
 *     in `x-csrf-token` (`packages/server/src/auth/guards.ts`).
 *   - **JSON in and out.** A `Content-Type` is sent only with a body — Fastify
 *     refuses an empty body that claims to be JSON — and a 204 resolves to
 *     `undefined`.
 *   - **Every failure is an {@link ApiError}.** A rejected `fetch`, the timeout
 *     and every non-2xx are classified once, in `ApiError.ts`. No screen parses
 *     a status code.
 *
 * It also reports what it saw to {@link ApiClient.subscribe}rs, which is how the
 * global handlers work without any screen's help (X2): a `signed_out` failure
 * routes to sign-in, a connectivity failure raises the banner, and the next
 * answer from the server — any answer, a 404 included — lowers it again.
 */

import { ApiError, classifyResponse } from './ApiError';

/** The script-readable half of the double-submit pair. */
export const CSRF_COOKIE = 'cafe_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Long enough for a slow till on café Wi-Fi; shorter than nginx's 30 s proxy timeout. */
export const DEFAULT_TIMEOUT_MS = 15_000;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * What a subscriber hears. `reachable` follows every HTTP answer below 500 —
 * the server was there to refuse, so connectivity is back; `failure` follows
 * every thrown {@link ApiError}.
 */
export type ApiEvent = { type: 'reachable' } | { type: 'failure'; error: ApiError };

export type ApiListener = (event: ApiEvent) => void;

/** The subscribe half on its own — what `Services` exposes to the UI. */
export interface ApiEvents {
  subscribe(listener: ApiListener): () => void;
}

export interface ApiClientOptions {
  /** Where the API is mounted. `/api` behind nginx and the Vite proxy. */
  baseUrl: string;
  /** Injectable for tests and for a Node harness with a cookie jar (UI-2). */
  fetch?: typeof fetch;
  /** Reads the CSRF cookie. Defaults to `document.cookie`. */
  readCsrfToken?: () => string | null;
  timeoutMs?: number;
}

export class ApiClient implements ApiEvents {
  private readonly listeners = new Set<ApiListener>();
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly readCsrfToken: () => string | null;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // Bound late, not captured: a test that stubs the global after construction
    // still gets its stub.
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.readCsrfToken = options.readCsrfToken ?? readCookie(CSRF_COOKIE);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  subscribe(listener: ApiListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (MUTATING.has(method)) {
      const token = this.readCsrfToken();
      if (token) headers[CSRF_HEADER] = token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let parsed: unknown;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      parsed = await readJson(response);
    } catch {
      // A rejected fetch says nothing useful — the browser hides the cause of a
      // network failure on purpose — and an abort is our own timeout. Both mean
      // the same thing to a person at the till: the server did not answer.
      throw this.fail(new ApiError({ kind: 'offline' }));
    } finally {
      clearTimeout(timer);
    }

    // A 2xx that is not JSON did not come from the API — typically a dev server
    // or a misrouted proxy answering with the SPA's own index.html.
    if (response.ok && parsed === NOT_JSON) {
      throw this.fail(new ApiError({ kind: 'server', status: response.status }));
    }
    if (response.status < 500) this.emit({ type: 'reachable' });
    if (response.ok) return parsed as T;
    const refusal = parsed === NOT_JSON ? null : parsed;
    throw this.fail(
      new ApiError(classifyResponse(response.status, refusal, response.headers.get('retry-after'))),
    );
  }

  private fail(error: ApiError): ApiError {
    this.emit({ type: 'failure', error });
    return error;
  }

  private emit(event: ApiEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not turn a delivered answer into a failure.
      }
    }
  }
}

const NOT_JSON = Symbol('not-json');

/** The body as JSON; `undefined` when there is none; {@link NOT_JSON} when it does not parse. */
async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

function readCookie(name: string): () => string | null {
  return () => {
    if (typeof document === 'undefined') return null;
    for (const pair of document.cookie.split(';')) {
      const equals = pair.indexOf('=');
      if (equals < 0 || pair.slice(0, equals).trim() !== name) continue;
      const value = pair.slice(equals + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
    return null;
  };
}
