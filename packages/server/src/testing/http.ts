/**
 * A browser-shaped HTTP harness for the route tests.
 *
 * Everything Phase 4 claims lives at the boundary — the tier guards, the
 * session-derived actor, the CSRF header, the status codes — so a test that
 * called a handler directly would prove none of it. These helpers drive
 * `app.inject()` while keeping a cookie jar the way a browser does, so a test
 * sees exactly what a real client would.
 */

import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { CSRF_COOKIE, CSRF_HEADER } from '../auth/guards.js';

/** Cookie name → value, as a browser would hold them for one device. */
export type Jar = Record<string, string>;

export function collectCookies(jar: Jar, headers: Record<string, unknown>): Jar {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [String(raw)];
  for (const entry of list) {
    const [pair = '', ...attributes] = String(entry).split(';');
    const equals = pair.indexOf('=');
    if (equals < 1) continue;
    const name = pair.slice(0, equals).trim();
    const value = decodeURIComponent(pair.slice(equals + 1).trim());
    const expired = attributes.some((a) => a.trim().toLowerCase() === 'max-age=0');
    if (expired || value === '') delete jar[name];
    else jar[name] = value;
  }
  return jar;
}

export function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

/**
 * A request carrying the jar's cookies and echoing its CSRF token, updating the
 * jar from whatever comes back — a device, not a request.
 */
export async function send(
  app: FastifyInstance,
  jar: Jar,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  const csrf = jar[CSRF_COOKIE];
  const response = await app.inject({
    ...options,
    headers: {
      ...(Object.keys(jar).length > 0 ? { cookie: cookieHeader(jar) } : {}),
      ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
      ...options.headers,
    },
  });
  collectCookies(jar, response.headers as Record<string, unknown>);
  return response;
}

/** Signs a device in and returns the jar holding the resulting session. */
export async function signIn(
  app: FastifyInstance,
  username: string,
  password: string,
  remember = true,
): Promise<Jar> {
  const jar: Jar = {};
  await send(app, jar, {
    method: 'POST',
    url: '/auth/login',
    payload: { username, password, remember },
  });
  return jar;
}
