/**
 * The auth routes, end to end against a real database and a real Fastify.
 *
 * This is the phase's "done when": sign-in, a session that lasts until its TTL
 * (no PIN, no idle lock — SCOPE-DECISIONS §6.3) and "sign out all devices"
 * working over HTTP. Everything goes through `app.inject`, so
 * the cookies, the CSRF header and the status codes are the ones a browser would
 * actually see — a test that called the handlers directly would prove nothing
 * about the boundary, which is where all of this lives.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { AuthDeps } from '../auth/guards.js';
import { createAuthDeps, CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../auth/guards.js';
import { EPHEMERAL_TTL_MS, REMEMBERED_TTL_MS } from '../auth/sessions.js';
import type { Db } from '../db.js';
import { migrate } from '../migrate.js';
import { PostgresStore } from '../PostgresStore.js';
import { buildServer } from '../server.js';
import { resetSchema, testPool } from '../testing/database.js';

const PASSWORD = 'correct horse battery staple';
/** The retired idle lock's window. Sessions must now outlast it. */
const FIVE_MINUTES = 5 * 60 * 1000;

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let clock: number;

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  clock = Date.parse('2026-09-15T09:00:00.000Z');
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: true, now: () => clock });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await db.end();
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** A cookie jar, the way a browser would keep one. */
type Jar = Record<string, string>;

function collectCookies(
  jar: Jar,
  headers: Record<string, unknown>,
): Jar {
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

function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

/** A request carrying the jar's cookies and its CSRF token. */
async function send(jar: Jar, options: InjectOptions) {
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

async function createAccount(
  username: string,
  over: { role?: 'admin' | 'staff'; name?: string } = {},
) {
  return store.createStaff({
    username,
    password: PASSWORD,
    role: over.role ?? 'staff',
    name: over.name,
  });
}

/** Signs in and returns the jar holding the resulting session. */
async function signIn(
  username: string,
  over: { password?: string; remember?: boolean } = {},
): Promise<{ jar: Jar; body: Record<string, unknown> }> {
  const jar: Jar = {};
  const response = await send(jar, {
    method: 'POST',
    url: '/auth/login',
    payload: {
      username,
      password: over.password ?? PASSWORD,
      remember: over.remember ?? true,
    },
  });
  return { jar, body: response.json() };
}

async function auditActions(): Promise<string[]> {
  const rows = await store.listAudit({ limit: 100 });
  return rows.map((row) => row.action);
}

// ── sign-in ───────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('signs a staff member in and sets both cookies', async () => {
    const account = await createAccount('ada', { name: 'Ada', role: 'staff' });

    const jar: Jar = {};
    const response = await send(jar, {
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD, remember: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'active',
      actor: { id: account.id, username: 'ada', name: 'Ada', role: 'staff' },
      remembered: true,
    });
    expect(jar[SESSION_COOKIE]).toBeTruthy();
    expect(jar[CSRF_COOKIE]).toBeTruthy();
  });

  it('hides the session cookie from scripts and requires HTTPS for it', async () => {
    await createAccount('ada');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
    });

    const cookies = response.headers['set-cookie'] as string[];
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    const csrf = cookies.find((c) => c.startsWith(`${CSRF_COOKIE}=`)) ?? '';

    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=Lax');
    // The CSRF partner must NOT be HttpOnly — a token the page cannot read is a
    // token the page cannot submit.
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('Secure');
  });

  it('never returns a credential', async () => {
    await createAccount('ada');
    const { body } = await signIn('ada');
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('$argon2');
    expect(body).not.toHaveProperty('actor.passwordHash');
  });

  it('verifies the stored hash instead of comparing it (§4-A)', async () => {
    // The prototype compares `passwordHash === password`. If the server did the
    // same, sending the stored digest would authenticate — which is what makes a
    // client-computed hash *be* the password.
    const account = await createAccount('ada');
    const stored = (await store.getStaffByUsername('ada'))?.passwordHash ?? '';
    expect(stored).toMatch(/^\$argon2id\$/);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: stored },
    });
    expect(response.statusCode).toBe(401);
    expect(account.id).toBeTruthy();
  });

  it('answers identically for a wrong password, an unknown user and a disabled account', async () => {
    await createAccount('ada');
    const disabled = await createAccount('grace');
    await store.setStaffActive(disabled.id, false);

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: 'nope' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'nobody', password: 'nope' },
    });
    const off = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'grace', password: PASSWORD },
    });

    for (const response of [wrong, unknown, off]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_credentials' });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('matches on a username case-insensitively but trims nothing else away', async () => {
    await createAccount('ada');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: '  ADA  ', password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });

  it('audits both outcomes, recording the id and never the username', async () => {
    const account = await createAccount('ada');
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: 'nope' },
    });
    await signIn('ada');

    expect(await auditActions()).toEqual(
      expect.arrayContaining(['staff.login.failed', 'staff.login']),
    );
    const entries = await store.listAudit({ limit: 100 });
    expect(entries.every((entry) => !JSON.stringify(entry).includes(PASSWORD))).toBe(true);
    expect(entries.some((entry) => entry.targetId === account.id)).toBe(true);
  });

  it('records an unknown sign-in attempt without inventing an actor', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'nobody', password: 'nope' },
    });
    const entries = await store.listAudit({ action: 'staff.login.failed' });
    expect(entries[0]).toMatchObject({ actorId: 'unknown', actorRole: 'system' });
  });

  it('rejects a malformed body without echoing it back', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada@example.com' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(response.body).not.toContain('ada@example.com');
  });
});

// ── rate limiting ─────────────────────────────────────────────────────────────

describe('sign-in rate limiting', () => {
  const miss = (username: string) =>
    app.inject({ method: 'POST', url: '/auth/login', payload: { username, password: 'nope' } });

  it('locks an account out after five misses, and the right password no longer helps', async () => {
    await createAccount('ada');
    for (let i = 0; i < 5; i += 1) expect((await miss('ada')).statusCode).toBe(401);

    const locked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'rate_limited' });
    expect(locked.headers['retry-after']).toBe('900');
  });

  it('lets the account back in once the lockout has been served', async () => {
    await createAccount('ada');
    for (let i = 0; i < 5; i += 1) await miss('ada');

    clock += 15 * 60 * 1000 + 1;
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });

  it('does not let one attacked account lock out the rest of the café', async () => {
    // The per-IP bucket is deliberately looser than the per-account one: a whole
    // café shares one address, and locking that out locks out the till.
    await createAccount('ada');
    await createAccount('grace');
    for (let i = 0; i < 5; i += 1) await miss('ada');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'grace', password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });

  it('stops a spray across many accounts from one address', async () => {
    for (let i = 0; i < 20; i += 1) await miss(`victim-${i}`);
    await createAccount('ada');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
    });
    expect(response.statusCode).toBe(429);
  });

  it('never throttles a terminal that keeps signing in correctly', async () => {
    await createAccount('ada');
    for (let i = 0; i < 8; i += 1) {
      const { body } = await signIn('ada');
      expect(body.status).toBe('active');
    }
  });
});

// ── the session: TTL only, no idle lock ───────────────────────────────────────

describe('GET /auth/session', () => {
  it('answers anon for a visitor with no cookie, and does not treat it as an error', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/session' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'anon', epoch: 0 });
  });

  it('recognises a signed-in terminal across requests', async () => {
    await createAccount('ada', { name: 'Ada' });
    const { jar } = await signIn('ada');

    const response = await send(jar, { method: 'GET', url: '/auth/session' });
    expect(response.json()).toMatchObject({
      status: 'active',
      actor: { username: 'ada', name: 'Ada' },
      remembered: true,
    });
  });

  it('ignores a forged session cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` },
    });
    expect(response.json()).toMatchObject({ status: 'anon' });
  });

  it('keeps a remembered till signed in after more than five idle minutes', async () => {
    // SCOPE-DECISIONS §6.3: a shared till, no PIN, no idle lock. "Remember me"
    // is how a login persists.
    await createAccount('ada');
    const { jar } = await signIn('ada', { remember: true });

    clock += FIVE_MINUTES + 1;
    expect((await send(jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'active',
      actor: { username: 'ada' },
      remembered: true,
    });

    // And it can still act — the staff guard has no locked state to refuse.
    clock += 6 * 60 * 60 * 1000;
    expect((await send(jar, { method: 'GET', url: '/config' })).statusCode).toBe(200);
  });

  it('keeps a non-remembered device signed in past five idle minutes too', async () => {
    await createAccount('ada');
    const { jar } = await signIn('ada', { remember: false });

    clock += FIVE_MINUTES + 1;
    expect((await send(jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'active',
      remembered: false,
    });
  });

  it('still ends a remembered session at its 30-day TTL', async () => {
    await createAccount('ada');
    const { jar } = await signIn('ada', { remember: true });

    clock += REMEMBERED_TTL_MS - 1_000;
    expect((await send(jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'active',
    });

    // Use does not extend it: the TTL is absolute.
    clock += 1_000;
    expect((await send(jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'anon',
    });
  });

  it('still ends a one-off sign-in at its 12-hour TTL', async () => {
    await createAccount('ada');
    const { jar } = await signIn('ada', { remember: false });

    clock += EPHEMERAL_TTL_MS - 1_000;
    expect((await send(jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'active',
    });

    clock += 1_000;
    expect((await send(jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'anon',
    });
  });
});

// ── signing out ───────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('ends the session and clears both cookies', async () => {
    await createAccount('ada');
    const { jar } = await signIn('ada');
    const sessionToken = jar[SESSION_COOKIE] ?? '';

    const response = await send(jar, { method: 'POST', url: '/auth/logout' });
    expect(response.statusCode).toBe(204);
    expect(jar[SESSION_COOKIE]).toBeUndefined();
    expect(jar[CSRF_COOKIE]).toBeUndefined();

    // And the row is gone, so a copy of the cookie is worthless.
    const replay = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `${SESSION_COOKIE}=${sessionToken}` },
    });
    expect(replay.json()).toMatchObject({ status: 'anon' });
  });

  it('succeeds for a caller who was not signed in', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/logout' })).statusCode).toBe(204);
  });
});

describe('POST /auth/logout-all', () => {
  it('ends every staff session everywhere and bumps the epoch', async () => {
    await createAccount('root', { role: 'admin' });
    await createAccount('ada');
    const admin = await signIn('root');
    const till = await signIn('ada');

    const response = await send(admin.jar, { method: 'POST', url: '/auth/logout-all' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ epoch: 1 });
    // Both the other till and the admin's own device.
    expect((await send(till.jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'anon',
      epoch: 1,
    });
    expect(admin.jar[SESSION_COOKIE]).toBeUndefined();
  });

  it('is refused to a staff account', async () => {
    await createAccount('ada');
    const { jar } = await signIn('ada');

    const response = await send(jar, { method: 'POST', url: '/auth/logout-all' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
  });

  it('is refused to a caller with no session at all', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/logout-all' });
    expect(response.statusCode).toBe(401);
  });

  it('works from an admin till that has sat idle — there is no lock to clear first', async () => {
    await createAccount('root', { role: 'admin' });
    const { jar } = await signIn('root');
    clock += FIVE_MINUTES + 1;

    const response = await send(jar, { method: 'POST', url: '/auth/logout-all' });
    expect(response.statusCode).toBe(200);
  });

  it('audits itself as a config change, the same shape the prototype writes', async () => {
    await createAccount('root', { role: 'admin' });
    const { jar } = await signIn('root');
    await send(jar, { method: 'POST', url: '/auth/logout-all' });

    const entries = await store.listAudit({ action: 'config.update' });
    expect(entries[0]).toMatchObject({ action: 'config.update', details: 'sessionEpoch' });
  });

  it('lets everyone back in with their password afterwards', async () => {
    await createAccount('root', { role: 'admin' });
    const { jar } = await signIn('root');
    await send(jar, { method: 'POST', url: '/auth/logout-all' });

    const again = await signIn('root');
    expect(again.body).toMatchObject({ status: 'active', epoch: 1 });
  });
});

// ── CSRF and origin ───────────────────────────────────────────────────────────

describe('the CSRF boundary', () => {
  it('refuses a mutating request from a session that does not present the token', async () => {
    await createAccount('ada');
    const { jar } = await signIn('ada');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'csrf_failed' });
    // And the session survives — a blocked forgery must not sign anyone out.
    expect((await send(jar, { method: 'GET', url: '/auth/session' })).json()).toMatchObject({
      status: 'active',
    });
  });

  it('refuses a token minted for another session', async () => {
    await createAccount('ada');
    await createAccount('grace');
    const victim = await signIn('ada');
    const attacker = await signIn('grace');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: cookieHeader({ [SESSION_COOKIE]: victim.jar[SESSION_COOKIE] ?? '' }),
        [CSRF_HEADER]: attacker.jar[CSRF_COOKIE] ?? '',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not require a token on a read', async () => {
    await createAccount('ada');
    const { jar } = await signIn('ada');

    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: cookieHeader(jar) },
    });
    expect(response.statusCode).toBe(200);
  });

  it('does not require a token to sign in, which has no session yet', async () => {
    await createAccount('ada');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a mutating request announcing a foreign origin', async () => {
    // Covers sign-in, which has no session and so no token to double-submit.
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
      headers: { origin: 'https://evil.example', host: 'till.cafe.test' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden_origin' });
  });

  it('accepts a mutating request from its own origin', async () => {
    await createAccount('ada');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
      headers: { origin: 'https://till.cafe.test', host: 'till.cafe.test' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('accepts a configured extra origin, for a dev server on another port', async () => {
    await app.close();
    deps = createAuthDeps({
      db,
      store,
      cookieSecure: false,
      allowedOrigins: ['http://localhost:5173'],
      now: () => clock,
    });
    app = buildServer({ logLevel: 'silent', auth: deps });
    await app.ready();
    await createAccount('ada');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: PASSWORD },
      headers: { origin: 'http://localhost:5173', host: 'localhost:3000' },
    });
    expect(response.statusCode).toBe(200);
  });
});

// ── the tier boundary these guards exist for ──────────────────────────────────

describe('the session is the only source of identity', () => {
  it('will not let a customer session act as staff', async () => {
    // BACKEND-PLAN §2, *Actor*: a customer's device holds a customer session and
    // can therefore never act as staff, whatever it puts in the request.
    const customer = await store.createCustomer({
      token: 'token-customer-1',
      displayName: 'Card Holder',
      email: 'holder@cafe.test',
    });
    const issued = await deps.sessions.issueCustomer(customer.id);
    const jar: Jar = { [SESSION_COOKIE]: issued.token, [CSRF_COOKIE]: issued.csrfToken };

    const response = await send(jar, { method: 'POST', url: '/auth/logout-all' });
    expect(response.statusCode).toBe(401);
  });

  it('reports a customer session as anon on the staff session route', async () => {
    const customer = await store.createCustomer({
      token: 'token-customer-2',
      displayName: 'Card Holder',
      email: 'holder2@cafe.test',
    });
    const issued = await deps.sessions.issueCustomer(customer.id);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `${SESSION_COOKIE}=${issued.token}` },
    });
    expect(response.json()).toMatchObject({ status: 'anon' });
  });
});

// ── credentials never reach a log ─────────────────────────────────────────────

describe('what the logs see', () => {
  it('records a sign-in without the password or the session token', async () => {
    // BACKEND-PLAN §6: "credentials are never stored or logged recoverably".
    // The request serializer is an allow-list, so this is a regression guard on
    // the one path that actually handles a credential.
    await app.close();
    const lines: string[] = [];
    app = buildServer({
      logLevel: 'info',
      auth: deps,
      loggerDestination: { write: (line: string) => lines.push(line) },
    });
    await app.ready();
    await createAccount('ada');

    const { jar } = await signIn('ada');
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ada', password: 'wrong-but-secret' },
    });

    const logged = lines.join('');
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain('wrong-but-secret');
    expect(logged).not.toContain(jar[SESSION_COOKIE] ?? 'no-session');
    expect(logged).not.toContain(jar[CSRF_COOKIE] ?? 'no-csrf');
  });
});

// ── the health surface stays independent of all of this ───────────────────────

describe('the health surface', () => {
  it('answers without a session and without touching the database', async () => {
    await db.end();
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { cookie: `${SESSION_COOKIE}=whatever` },
    });

    expect(response.statusCode).toBe(200);
    // Reopened so afterEach can close it cleanly.
    db = testPool();
  });
});
