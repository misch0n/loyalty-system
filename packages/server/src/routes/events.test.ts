/**
 * `GET /events` — Phase 7's "done when": *a commit on the till updates the
 * customer's open card without a reload.*
 *
 * Driven over a **real socket** rather than `app.inject()`, because the claims
 * are about a connection that stays open: that an event arrives while the
 * request that triggered it is still in flight, that the socket is still there
 * afterwards, and that it is gone when it should be. A simulated request has
 * none of those properties.
 *
 * The security claim here is the mirror of `routes/activity.ts`'s: a stream
 * hears about its own subject and no other, and there is no parameter that
 * changes that. It is asserted twice — once as a delivery and once as a silence.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Customer } from '@cafe/shared/domain/models';
import { createAuthDeps, type AuthDeps } from '../auth/guards.js';
import type { Db } from '../db.js';
import { MAX_STREAMS_PER_SESSION } from '../events/hub.js';
import { migrate } from '../migrate.js';
import { PostgresStore } from '../PostgresStore.js';
import { buildServer } from '../server.js';
import { resetSchema, testPool } from '../testing/database.js';
import { cookieHeader, send, signIn, type Jar } from '../testing/http.js';
import { listen, openSse, type SseClient } from '../testing/sse.js';

const ADMIN = { username: 'owner', password: 'owner-password-1', pin: '1111' };
const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let origin: string;

let cardA: Customer;
let cardB: Customer;
let phoneA: Jar;
let phoneB: Jar;
let till: Jar;
let adminJar: Jar;
let staffId: string;

/** Every stream opened by a test, closed in `afterEach` whatever happened. */
let streams: SseClient[] = [];

async function open(jar: Jar): Promise<SseClient> {
  const client = await openSse(origin, '/events', { cookie: cookieHeader(jar) });
  streams.push(client);
  return client;
}

async function registerCard(email: string): Promise<{ customer: Customer; jar: Jar }> {
  const jar: Jar = {};
  const response = await send(app, jar, {
    method: 'POST',
    url: '/customers',
    payload: { displayName: 'Card Holder', email },
  });
  expect(response.statusCode).toBe(201);
  return { customer: response.json() as Customer, jar };
}

let keyCounter = 0;
function commitPayload(pointsDelta = 1): Record<string, unknown> {
  keyCounter += 1;
  return {
    pointsDelta,
    redeemRewardIds: [],
    idempotencyKey: `events-test-key-${String(keyCounter).padStart(4, '0')}`,
    source: 'a',
  };
}

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: false });
  app = buildServer({ logLevel: 'silent', auth: deps });
  origin = await listen(app);

  await store.createStaff({ ...ADMIN, role: 'admin' });
  const barista = await store.createStaff({ ...STAFF, role: 'staff' });
  staffId = barista.id;

  const a = await registerCard('card-a@example.test');
  const b = await registerCard('card-b@example.test');
  cardA = a.customer;
  cardB = b.customer;
  phoneA = a.jar;
  phoneB = b.jar;
  till = await signIn(app, STAFF.username, STAFF.password);
  adminJar = await signIn(app, ADMIN.username, ADMIN.password);
  streams = [];
});

afterEach(async () => {
  for (const client of streams) client.close();
  await app.close();
  await db.end();
});

describe('opening a stream', () => {
  it('refuses an anonymous caller', async () => {
    // There is genuinely nothing to subscribe to, and holding a socket open to
    // say so would be worse than a 401.
    const client = await openSse(origin, '/events');
    streams.push(client);
    expect(client.statusCode).toBe(401);
    expect(JSON.parse(await client.body())).toEqual({ error: 'unauthorized' });
  });

  it('answers a customer device with an event stream', async () => {
    const client = await open(phoneA);
    expect(client.statusCode).toBe(200);
    expect(client.headers['content-type']).toContain('text/event-stream');
    expect(client.headers['x-accel-buffering']).toBe('no');
  });

  it('tells the subscriber what it is listening to', async () => {
    const client = await open(phoneA);
    await expect(client.next()).resolves.toEqual({
      event: 'hello',
      data: { scopes: [`customer:${cardA.id}`] },
    });
  });

  it('subscribes a till to its own actor, not to a card', async () => {
    const client = await open(till);
    await expect(client.next()).resolves.toEqual({
      event: 'hello',
      data: { scopes: [`staff:${staffId}`] },
    });
  });

  it('ignores a subject the caller names', async () => {
    // The route reads `request.auth` and nothing else — `guardrails.test.ts`
    // fails if it ever reads the query, the body or the params. This is the same
    // claim from outside: asking for someone else's card gets you your own, and
    // then gets you nothing when theirs changes.
    const client = await openSse(origin, `/events?topic=customer:${cardB.id}`, {
      cookie: cookieHeader(phoneA),
    });
    streams.push(client);
    await expect(client.next()).resolves.toEqual({
      event: 'hello',
      data: { scopes: [`customer:${cardA.id}`] },
    });

    await send(app, till, {
      method: 'POST',
      url: `/customers/${cardB.id}/commit`,
      payload: commitPayload(),
    });
    await expect(client.silentFor(300)).resolves.toBeUndefined();
  });

  it(`refuses a session's ${MAX_STREAMS_PER_SESSION + 1}th stream`, async () => {
    for (let i = 0; i < MAX_STREAMS_PER_SESSION; i += 1) {
      expect((await open(phoneA)).statusCode).toBe(200);
    }
    const refused = await open(phoneA);
    expect(refused.statusCode).toBe(429);
    expect(JSON.parse(await refused.body())).toEqual({
      error: 'too_many_streams',
      limit: MAX_STREAMS_PER_SESSION,
    });
  });
});

describe('a commit reaches the customer’s open card', () => {
  it('pushes `changed` while the card is open', async () => {
    // Phase 7's whole reason to exist: the cups fill while the customer is still
    // standing at the counter watching them.
    const client = await open(phoneA);
    await client.next(); // hello

    const response = await send(app, till, {
      method: 'POST',
      url: `/customers/${cardA.id}/commit`,
      payload: commitPayload(),
    });
    expect(response.statusCode).toBe(200);

    await expect(client.next()).resolves.toEqual({
      event: 'changed',
      data: { scope: 'customer', id: cardA.id, reason: 'commit' },
    });
  });

  it('pushes nothing to another customer’s device', async () => {
    // The authorization claim as a silence. A stream that heard about a card it
    // does not hold would be a cross-account read with a different verb.
    const mine = await open(phoneA);
    const theirs = await open(phoneB);
    await mine.next();
    await theirs.next();

    await send(app, till, {
      method: 'POST',
      url: `/customers/${cardA.id}/commit`,
      payload: commitPayload(),
    });

    await expect(mine.next()).resolves.toMatchObject({ event: 'changed' });
    await expect(theirs.silentFor(300)).resolves.toBeUndefined();
  });

  it('tells the committing till its own activity changed', async () => {
    const client = await open(till);
    await client.next();

    await send(app, till, {
      method: 'POST',
      url: `/customers/${cardA.id}/commit`,
      payload: commitPayload(),
    });

    await expect(client.next()).resolves.toEqual({
      event: 'changed',
      data: { scope: 'staff', id: staffId, reason: 'activity' },
    });
  });

  it('pushes nothing on a replayed commit', async () => {
    // A retry writes no ledger rows, no audit rows and sends no mail; it must
    // not push either, or one accrual looks like two.
    const payload = commitPayload();
    await send(app, till, {
      method: 'POST',
      url: `/customers/${cardA.id}/commit`,
      payload,
    });

    const client = await open(phoneA);
    await client.next();

    const replay = await send(app, till, {
      method: 'POST',
      url: `/customers/${cardA.id}/commit`,
      payload,
    });
    expect(replay.json()).toMatchObject({ ok: true, replayed: true });
    await expect(client.silentFor(300)).resolves.toBeUndefined();
  });

  it('pushes nothing when the commit was refused', async () => {
    const client = await open(phoneA);
    await client.next();

    const response = await send(app, till, {
      method: 'POST',
      url: '/customers/does-not-exist/commit',
      payload: commitPayload(),
    });
    expect(response.statusCode).toBe(404);
    await expect(client.silentFor(300)).resolves.toBeUndefined();
  });
});

describe('the other changes a card can undergo', () => {
  it('pushes `ledger` for a correction', async () => {
    const client = await open(phoneA);
    await client.next();

    await send(app, till, {
      method: 'POST',
      url: `/customers/${cardA.id}/transactions`,
      payload: { type: 'accrual', points: 2 },
    });

    await expect(client.next()).resolves.toEqual({
      event: 'changed',
      data: { scope: 'customer', id: cardA.id, reason: 'ledger' },
    });
  });

  it('pushes `card` when the token is rotated', async () => {
    // The device may be showing the QR that just stopped working, which makes
    // this the one signal a screen must not miss.
    const client = await open(phoneA);
    await client.next();

    await send(app, till, { method: 'POST', url: `/customers/${cardA.id}/rotate-token` });

    await expect(client.next()).resolves.toEqual({
      event: 'changed',
      data: { scope: 'customer', id: cardA.id, reason: 'card' },
    });
  });

  it('pushes `card` when staff correct the details', async () => {
    const client = await open(phoneA);
    await client.next();

    await send(app, till, {
      method: 'PATCH',
      url: `/customers/${cardA.id}`,
      payload: { displayName: 'Corrected Name' },
    });

    await expect(client.next()).resolves.toMatchObject({
      data: { scope: 'customer', reason: 'card' },
    });
  });

  it('pushes `deleted` and then ends the stream', async () => {
    // An admin deleting someone else's card reaches that device this way and no
    // other — and a device listening to a tombstone has nothing left to hear.
    const client = await open(phoneA);
    await client.next();

    const response = await send(app, adminJar, {
      method: 'DELETE',
      url: `/customers/${cardA.id}`,
    });
    expect(response.statusCode).toBe(204);

    await expect(client.next()).resolves.toEqual({
      event: 'changed',
      data: { scope: 'customer', id: cardA.id, reason: 'deleted' },
    });
    await expect(client.ending()).resolves.toBeUndefined();
  });
});

describe('a stream never outlives its session', () => {
  it('ends when the device signs out', async () => {
    const client = await open(till);
    await client.next();

    await send(app, till, { method: 'POST', url: '/auth/logout' });
    await expect(client.ending()).resolves.toBeUndefined();
  });

  it('ends every till on "sign out all devices", and no customer', async () => {
    const tillStream = await open(till);
    const phoneStream = await open(phoneA);
    await tillStream.next();
    await phoneStream.next();

    await send(app, adminJar, { method: 'POST', url: '/auth/logout-all' });

    await expect(tillStream.ending()).resolves.toBeUndefined();
    expect(phoneStream.closed).toBe(false);
    // Still live, and still its own card's: the customer half of the channel is
    // deliberately outside staff revocation.
    await send(app, await signIn(app, STAFF.username, STAFF.password), {
      method: 'POST',
      url: `/customers/${cardA.id}/commit`,
      payload: commitPayload(),
    });
    await expect(phoneStream.next()).resolves.toMatchObject({ event: 'changed' });
  });

  it('ends when the account is disabled', async () => {
    // Every other consequence of being disabled arrives on the account's next
    // request. A held-open stream never makes one.
    const client = await open(till);
    await client.next();

    await send(app, adminJar, {
      method: 'PATCH',
      url: `/staff/${staffId}`,
      payload: { active: false },
    });
    await expect(client.ending()).resolves.toBeUndefined();
  });

  it('ends when the account is deleted', async () => {
    const client = await open(till);
    await client.next();

    await send(app, adminJar, { method: 'DELETE', url: `/staff/${staffId}` });
    await expect(client.ending()).resolves.toBeUndefined();
  });

  it('ends when the device is unbound from its card', async () => {
    const client = await open(phoneA);
    await client.next();

    await send(app, phoneA, { method: 'DELETE', url: '/me' });
    await expect(client.ending()).resolves.toBeUndefined();
  });

  it('follows the card when a device rebinds to another one', async () => {
    const client = await open(phoneA);
    await client.next();

    // `PUT /me` replaces the session, so the old stream — which is listening to
    // the card this device has stopped being — has to go with it.
    await send(app, phoneA, { method: 'PUT', url: '/me', payload: { token: cardB.token } });
    await expect(client.ending()).resolves.toBeUndefined();

    const rebound = await open(phoneA);
    await expect(rebound.next()).resolves.toEqual({
      event: 'hello',
      data: { scopes: [`customer:${cardB.id}`] },
    });
  });

  it('refuses a terminal that has idled into the lock', async () => {
    // A locked till is showing the PIN pad; it has no feed to keep fresh, and
    // the stream would otherwise be the one part of the session the idle lock
    // did not reach.
    let clock = Date.now();
    const lockedDeps = createAuthDeps({
      db,
      store,
      cookieSecure: false,
      now: () => clock,
    });
    const lockedApp = buildServer({ logLevel: 'silent', auth: lockedDeps });
    const lockedOrigin = await listen(lockedApp);
    try {
      const jar = await signIn(lockedApp, STAFF.username, STAFF.password, true);
      clock += 6 * 60 * 1000;
      const client = await openSse(lockedOrigin, '/events', { cookie: cookieHeader(jar) });
      streams.push(client);
      expect(client.statusCode).toBe(401);
      expect(JSON.parse(await client.body())).toEqual({ error: 'locked' });
    } finally {
      await lockedApp.close();
    }
  });
});

describe('shutdown', () => {
  it('does not hold `app.close()` open', async () => {
    // Nothing else in the server keeps a socket alive, so nothing else had to
    // think about this. Without the `preClose` hook a SIGTERM never completes
    // and the orchestrator escalates to SIGKILL mid-request.
    const client = await open(phoneA);
    await client.next();

    await Promise.race([
      app.close(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('app.close() hung on an open stream')), 3000),
      ),
    ]);
    await expect(client.ending()).resolves.toBeUndefined();
  });
});
