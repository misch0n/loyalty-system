/**
 * `/me` — the `IdentityStore` port over HTTP.
 *
 * These three routes are the answer to the durability gap `COLLAB-NOTES.md`
 * records as unsolvable client-side, so the tests are about what the cookie
 * *is*: HttpOnly (a script cannot read it, and ITP does not prune it the way it
 * prunes script-written storage), carrying a session id rather than the card
 * token, and pointing at exactly one card at a time.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Customer } from '@cafe/shared/domain/models';
import { createAuthDeps, SESSION_COOKIE, type AuthDeps } from '../auth/guards.js';
import type { Db } from '../db.js';
import { migrate } from '../migrate.js';
import { PostgresStore } from '../PostgresStore.js';
import { buildServer } from '../server.js';
import { resetSchema, testPool } from '../testing/database.js';
import { send, signIn, type Jar } from '../testing/http.js';

const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: true });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();
  await store.createStaff({ ...STAFF, role: 'staff' });
});

afterEach(async () => {
  await app.close();
  await db.end();
});

async function register(email: string): Promise<{ customer: Customer; jar: Jar }> {
  const jar: Jar = {};
  const response = await send(app, jar, {
    method: 'POST',
    url: '/customers',
    payload: { displayName: 'Card Holder', email },
  });
  return { customer: response.json() as Customer, jar };
}

describe('GET /me', () => {
  it('answers null rather than an error when the browser is not recognised', async () => {
    const response = await send(app, {}, { method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ token: null });
  });

  it('returns only the opaque token, never PII', async () => {
    const { customer, jar } = await register('me@example.test');
    const response = await send(app, jar, { method: 'GET', url: '/me' });
    expect(response.json()).toEqual({ token: customer.token });
    expect(response.body).not.toContain('me@example.test');
    expect(response.body).not.toContain('Card Holder');
  });

  it('forgets a card that has been deleted', async () => {
    const { customer, jar } = await register('gone@example.test');
    await send(app, jar, { method: 'DELETE', url: `/customers/${customer.id}` });
    const response = await send(app, jar, { method: 'GET', url: '/me' });
    expect(response.json()).toEqual({ token: null });
  });
});

describe('PUT /me', () => {
  it('binds this browser to the card whose token it presents', async () => {
    const { customer } = await register('binder@example.test');
    const fresh: Jar = {};
    const response = await send(app, fresh, {
      method: 'PUT',
      url: '/me',
      payload: { token: customer.token },
    });
    expect(response.statusCode).toBe(200);
    expect(fresh[SESSION_COOKIE]).toBeTruthy();
    expect((await send(app, fresh, { method: 'GET', url: '/me' })).json()).toEqual({
      token: customer.token,
    });
  });

  it('sets the session cookie HttpOnly, so no script can read it', async () => {
    const { customer } = await register('httponly@example.test');
    const response = await app.inject({
      method: 'PUT',
      url: '/me',
      payload: { token: customer.token },
    });
    const cookies = ([] as string[]).concat(
      (response.headers['set-cookie'] as string[] | string) ?? [],
    );
    const session = cookies.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
    expect(session?.toLowerCase()).toContain('httponly');
    // …and the cookie carries a session id, not the card's token.
    expect(session).not.toContain(customer.token);
  });

  it('replaces the previous card rather than accumulating cards', async () => {
    const { jar } = await register('first@example.test');
    const { customer: second } = await register('second@example.test');

    await send(app, jar, { method: 'PUT', url: '/me', payload: { token: second.token } });
    expect((await send(app, jar, { method: 'GET', url: '/me' })).json()).toEqual({
      token: second.token,
    });
  });

  it('refuses an unknown token', async () => {
    const response = await send(app, {}, {
      method: 'PUT',
      url: '/me',
      payload: { token: 'AAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses to turn a till into a customer’s device', async () => {
    const { customer } = await register('till@example.test');
    const staff = await signIn(app, STAFF.username, STAFF.password);
    const response = await send(app, staff, {
      method: 'PUT',
      url: '/me',
      payload: { token: customer.token },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'staff_device' });

    const session = await send(app, staff, { method: 'GET', url: '/auth/session' });
    expect((session.json() as { status: string }).status).toBe('active');
  });
});

describe('DELETE /me', () => {
  it('forgets the card and ends the session behind it', async () => {
    const { jar } = await register('forgettable@example.test');
    const response = await send(app, jar, { method: 'DELETE', url: '/me' });
    expect(response.statusCode).toBe(204);
    expect(jar[SESSION_COOKIE]).toBeUndefined();
    expect((await send(app, jar, { method: 'GET', url: '/me' })).json()).toEqual({ token: null });
  });

  it('succeeds when there is nothing to forget', async () => {
    const response = await send(app, {}, { method: 'DELETE', url: '/me' });
    expect(response.statusCode).toBe(204);
  });

  it('leaves a signed-in staff session alone', async () => {
    const staff = await signIn(app, STAFF.username, STAFF.password);
    await send(app, staff, { method: 'DELETE', url: '/me' });
    const session = await send(app, staff, { method: 'GET', url: '/auth/session' });
    expect((session.json() as { status: string }).status).toBe('active');
  });
});
