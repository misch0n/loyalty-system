/**
 * The request-side of auth: who is calling, and may they.
 *
 * Three things are installed here, in the order a request meets them:
 *   1. **Session resolution** — the cookie becomes `request.auth`, or `null`.
 *   2. **Origin + CSRF** — a mutating request from a session must prove it was
 *      made by our own page, not by someone else's.
 *   3. **Tier guards** — `requireStaff` / `requireAdmin`, used as route
 *      `preHandler`s. Phase 4 builds the rest of the authorization matrix on
 *      these; Phase 3 needs them for the auth routes themselves.
 *
 * BACKEND-PLAN §2, *Actor*: the acting identity is **always** derived from the
 * session here and never read from a request body. That is the anti-fraud anchor
 * from `CLAUDE.md` ("staff initiates the credit") made real — a customer's device
 * holds a customer session and can therefore never commit points, whatever it
 * puts in the JSON.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DataStore } from '@cafe/shared/ports/DataStore';
import type { Db } from '../db';
import { clearCookie, parseCookies, serializeCookie, type CookieOptions } from './cookies';
import { AttemptLimiter } from './rateLimit';
import {
  CUSTOMER_TTL_MS,
  EPHEMERAL_TTL_MS,
  REMEMBERED_TTL_MS,
  SessionStore,
  type IssuedSession,
  type ResolvedSession,
} from './sessions';

/** HttpOnly — the page never reads it, it only travels. */
export const SESSION_COOKIE = 'cafe_session';
/** Script-readable by design: the SPA reads it and echoes it in the header. */
export const CSRF_COOKIE = 'cafe_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Methods that can change something, and so need CSRF protection. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The health surface skips session resolution entirely. `/healthz` promises to
 * answer without touching the database — a promise a session lookup on a probe
 * carrying a stray cookie would quietly break.
 */
const UNAUTHENTICATED_PATHS = new Set(['/healthz', '/readyz']);

export interface AuthDeps {
  db: Db;
  store: DataStore;
  sessions: SessionStore;
  /** `Secure` on the cookies. Off only for plain-HTTP local development. */
  cookieSecure: boolean;
  /**
   * Extra origins accepted on mutating requests. The deployed bundle serves the
   * SPA and the API from one origin, so this is empty there; a Vite dev server
   * on another port needs its origin listed.
   */
  allowedOrigins: readonly string[];
  /** Failed sign-ins per account. */
  loginUserLimiter: AttemptLimiter;
  /** Failed sign-ins per source address, across all accounts. */
  loginIpLimiter: AttemptLimiter;
  /** Failed PIN unlocks per account. */
  pinLimiter: AttemptLimiter;
}

export interface CreateAuthDepsInput {
  db: Db;
  store: DataStore;
  cookieSecure: boolean;
  allowedOrigins?: readonly string[];
  /** Injectable clock — sessions and limiters share it, so tests move one dial. */
  now?: () => number;
}

/** Failure window and lockout, shared by all three buckets. */
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Assembles the auth dependencies.
 *
 * The limits, all inside a 15-minute window with a 15-minute lockout:
 *   • **5** failed sign-ins per *account* — tight, because it is the account
 *     under attack and a real person rarely misses five in a row.
 *   • **20** failed sign-ins per *source address* — looser, because a whole café
 *     shares one NAT address and locking it out would lock out the till.
 *   • **5** failed PIN unlocks per account. Tightest in effect, since the PIN is
 *     four digits and an attacker reaching that route already knows whose
 *     account it is (BACKEND-PLAN §4-B).
 */
export function createAuthDeps(input: CreateAuthDepsInput): AuthDeps {
  const { now } = input;
  const shared = { windowMs: LOCKOUT_WINDOW_MS, lockoutMs: LOCKOUT_WINDOW_MS, now };
  return {
    db: input.db,
    store: input.store,
    sessions: new SessionStore(input.db, now),
    cookieSecure: input.cookieSecure,
    allowedOrigins: input.allowedOrigins ?? [],
    loginUserLimiter: new AttemptLimiter({ limit: 5, ...shared }),
    loginIpLimiter: new AttemptLimiter({ limit: 20, ...shared }),
    pinLimiter: new AttemptLimiter({ limit: 5, ...shared }),
  };
}

export type AuthState = ResolvedSession;

declare module 'fastify' {
  interface FastifyRequest {
    /** The resolved session, or `null` for an anonymous request. */
    auth: AuthState | null;
  }
}

function cookieOptions(deps: AuthDeps, maxAgeSec?: number): CookieOptions {
  return { path: '/', sameSite: 'Lax', secure: deps.cookieSecure, maxAgeSec };
}

/** Sets the session pair on a reply: HttpOnly token + readable CSRF partner. */
export function setSessionCookies(
  reply: FastifyReply,
  deps: AuthDeps,
  issued: IssuedSession,
  maxAgeSec: number,
): void {
  reply.header('set-cookie', [
    serializeCookie(SESSION_COOKIE, issued.token, {
      ...cookieOptions(deps, maxAgeSec),
      httpOnly: true,
    }),
    // Not HttpOnly: a double-submit token the page cannot read is a token the
    // page cannot submit. It is not a credential — the session cookie is.
    serializeCookie(CSRF_COOKIE, issued.csrfToken, cookieOptions(deps, maxAgeSec)),
  ]);
}

export function clearSessionCookies(reply: FastifyReply, deps: AuthDeps): void {
  reply.header('set-cookie', [
    clearCookie(SESSION_COOKIE, { ...cookieOptions(deps), httpOnly: true }),
    clearCookie(CSRF_COOKIE, cookieOptions(deps)),
  ]);
}

/** Cookie `Max-Age` matching the session's absolute lifetime. */
export function cookieMaxAgeSec(kind: 'staff' | 'customer', remembered: boolean): number {
  if (kind === 'customer') return Math.floor(CUSTOMER_TTL_MS / 1000);
  return Math.floor((remembered ? REMEMBERED_TTL_MS : EPHEMERAL_TTL_MS) / 1000);
}

/**
 * Same-origin check for mutating requests.
 *
 * `SameSite=Lax` already keeps our cookies off a cross-site POST, so this is the
 * second layer — and the one that covers sign-in, which has no session yet and
 * so has no CSRF token to double-submit. A browser always sends `Origin` on a
 * cross-origin request; a missing one is a same-origin or non-browser caller and
 * is left to the CSRF token.
 */
function originAllowed(request: FastifyRequest, deps: AuthDeps): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (deps.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/**
 * Installs session resolution and the CSRF boundary on every request.
 *
 * `onRequest` runs before body parsing, so an unauthenticated mutation is
 * refused before the server spends anything on it.
 */
export function installSessionHooks(app: FastifyInstance, deps: AuthDeps): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request, reply) => {
    if (UNAUTHENTICATED_PATHS.has(request.url.split('?')[0] ?? '')) return;

    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    request.auth = token ? await deps.sessions.resolve(token) : null;

    if (MUTATING.has(request.method)) {
      if (!originAllowed(request, deps)) {
        return reply.code(403).send({ error: 'forbidden_origin' });
      }
      if (request.auth) {
        const header = request.headers[CSRF_HEADER];
        const presented = Array.isArray(header) ? header[0] : header;
        if (!(await deps.sessions.verifyCsrf(request.auth.record.id, presented))) {
          return reply.code(403).send({ error: 'csrf_failed' });
        }
      }
    }

    // Activity is recorded on the way in, not on the way out: it is what the
    // idle lock measures, and a request that errors is still the staff member
    // being present at the till.
    if (request.auth?.state === 'active') {
      await deps.sessions.touch(request.auth.record.id);
    }
  });
}

/**
 * Route guard: an active staff (or admin) session.
 *
 * A locked session is refused as `locked`, not `unauthorized`, so the SPA knows
 * to show the PIN unlock rather than the full sign-in form — that distinction is
 * the whole point of a remembered terminal. Sending a reply from a `preHandler`
 * stops the chain, which is how {@link requireAdmin} composes on top.
 */
export async function requireStaff(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.auth;
  if (!auth || auth.record.kind !== 'staff' || !auth.actor) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  if (auth.state === 'locked') {
    return reply.code(401).send({ error: 'locked' });
  }
}

async function assertAdminRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.auth?.actor?.role !== 'admin') {
    return reply.code(403).send({ error: 'forbidden' });
  }
}

/**
 * Route guard: an active admin session. `CLAUDE.md` — "Admin = superset of
 * staff", so this is the staff guard plus a role check, never a separate path.
 */
export const requireAdmin = [requireStaff, assertAdminRole];
