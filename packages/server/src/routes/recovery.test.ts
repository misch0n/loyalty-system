/**
 * The recovery round trip, and the oracle it must not be.
 *
 * Phase 5's "done when" is two claims: *the round trip works*, and *an unknown
 * address is indistinguishable from a known one*. The second is the harder one
 * to keep, because every helpful-looking improvement breaks it — a "we don't
 * know that address" message, a 404, an awaited send. So the symmetry is
 * asserted directly, field by field, rather than being inferred from the
 * happy path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuditLogEntry, Customer } from '@cafe/shared/domain/models';
import { createAuthDeps, SESSION_COOKIE, type AuthDeps } from '../auth/guards';
import type { Db } from '../db';
import { migrate } from '../migrate';
import { PostgresStore } from '../PostgresStore';
import { RECOVERY_MAX_ATTEMPTS } from '../recovery/codes';
import { buildServer } from '../server';
import { resetSchema, testPool } from '../testing/database';
import { send, signIn, type Jar } from '../testing/http';
import { CollectingMailer } from '../testing/mail';

const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };
const EMAIL = 'lost@example.test';
const UNKNOWN = 'nobody@example.test';

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let mailer: CollectingMailer;
let card: Customer;

/** Registers a card without leaving the registration mail in the outbox. */
async function register(email: string): Promise<Customer> {
  const response = await send(app, {}, {
    method: 'POST',
    url: '/customers',
    payload: { displayName: 'Card Holder', email },
  });
  await deps.background.drain();
  mailer.clear();
  return response.json() as Customer;
}

/** Runs the request leg and returns the code that reached the inbox. */
async function requestCode(email = EMAIL, jar: Jar = {}): Promise<string | undefined> {
  await send(app, jar, { method: 'POST', url: '/recovery/request', payload: { email } });
  await deps.background.drain();
  return mailer.last('recovery')?.params.code;
}

async function recoverRows(): Promise<AuditLogEntry[]> {
  return store.listAudit({ action: 'customer.recover' });
}

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  mailer = new CollectingMailer();
  deps = createAuthDeps({
    db,
    store,
    cookieSecure: true,
    mailer,
    appUrl: 'https://cafe.example',
  });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();
  await store.createStaff({ ...STAFF, passwordHash: STAFF.password, role: 'staff' });
  card = await register(EMAIL);
});

afterEach(async () => {
  await deps.background.drain();
  await app.close();
  await db.end();
});

describe('the recovery round trip', () => {
  it('mails a code and binds the card to the device that types it', async () => {
    const jar: Jar = {};
    const code = await requestCode(EMAIL, jar);
    expect(code).toBeDefined();

    const response = await send(app, jar, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ token: card.token });

    // Bound: the device is now recognised as this card without presenting
    // anything further. This is `IdentityStore.set`, server-side.
    const me = await send(app, jar, { method: 'GET', url: '/me' });
    expect(me.json()).toEqual({ token: card.token });
  });

  it('accepts the code as the customer types it — spaced, hyphenated, lower case', async () => {
    const code = (await requestCode()) as string;
    const typed = `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase();

    const response = await send(app, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code: ` ${typed} ` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('sends a code and no link', async () => {
    // SCOPE-DECISIONS §2.3: a link opens on whichever device reads the mail,
    // which is exactly the device that should not be bound.
    await requestCode();
    const mail = mailer.last('recovery');
    expect(mail?.text).toMatch(/[0-9A-Z]{6}/);
    expect(mail?.text).not.toMatch(/https?:\/\//);
  });

  it('replaces the card a device was already bound to', async () => {
    // §3.2: recovery is the *only* un-bind. A customer holding someone else's
    // card on their phone recovers their own, and the cookie is overwritten.
    const other = await register('other@example.test');
    const jar: Jar = {};
    await send(app, jar, { method: 'GET', url: `/customers/by-token/${other.token}` });
    expect((await send(app, jar, { method: 'GET', url: '/me' })).json()).toEqual({
      token: other.token,
    });

    const code = await requestCode(EMAIL, jar);
    await send(app, jar, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });

    expect((await send(app, jar, { method: 'GET', url: '/me' })).json()).toEqual({
      token: card.token,
    });
  });

  it('records both legs in the audit log, with no address in them', async () => {
    const code = await requestCode();
    await send(app, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });

    const rows = await recoverRows();
    expect(rows.map((row) => row.details).sort()).toEqual(['redeemed', 'requested']);
    expect(rows.every((row) => row.actorId === 'system')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(EMAIL);
  });

  it('logs the request even when the mail server is down', async () => {
    // The trail must say recovery was asked for; whether the provider accepted
    // it is the provider's log to answer for.
    mailer.failWith = new Error('smtp is down');
    await send(app, {}, { method: 'POST', url: '/recovery/request', payload: { email: EMAIL } });
    await deps.background.drain();

    expect(await recoverRows()).toHaveLength(1);
  });
});

describe('no enumeration oracle', () => {
  it('answers a known and an unknown address identically', async () => {
    const known = await send(app, {}, {
      method: 'POST',
      url: '/recovery/request',
      payload: { email: EMAIL },
    });
    const unknown = await send(app, {}, {
      method: 'POST',
      url: '/recovery/request',
      payload: { email: UNKNOWN },
    });

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(known.statusCode).toBe(202);
  });

  it('answers before it has looked the address up at all', async () => {
    // The strongest available form of the guarantee: the response cannot depend
    // on a lookup that has not happened. An awaited send would make a known
    // address slower than an unknown one — readable with a stopwatch.
    await send(app, {}, { method: 'POST', url: '/recovery/request', payload: { email: EMAIL } });
    expect(mailer.outbox).toHaveLength(0);
    expect(deps.background.size).toBe(1);

    await deps.background.drain();
    expect(mailer.outbox).toHaveLength(1);
  });

  it('writes nothing and sends nothing for an unknown address', async () => {
    await send(app, {}, { method: 'POST', url: '/recovery/request', payload: { email: UNKNOWN } });
    await deps.background.drain();

    expect(mailer.outbox).toEqual([]);
    expect(await recoverRows()).toEqual([]);
  });

  it('will not recover a deleted card, and says so no differently', async () => {
    // The tombstone keeps its row but loses its address (§3.3), so the card is
    // simply not found — the same answer a stranger's address gets.
    const jar: Jar = {};
    await send(app, jar, { method: 'GET', url: `/customers/by-token/${card.token}` });
    await send(app, jar, { method: 'DELETE', url: `/customers/${card.id}` });

    await requestCode();
    expect(mailer.outbox).toEqual([]);
  });

  it('gives one refusal for every way a consume can fail', async () => {
    const code = (await requestCode()) as string;
    const wrongCode = code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';

    const refusals = [
      { email: UNKNOWN, code },
      { email: EMAIL, code: wrongCode },
      { email: UNKNOWN, code: wrongCode },
    ];
    for (const payload of refusals) {
      const response = await send(app, {}, {
        method: 'POST',
        url: '/recovery/consume',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_code' });
    }
  });
});

describe('what protects a six-character code', () => {
  it('refuses a code that belongs to a different address', async () => {
    // The scoping is the security: a guesser must not be able to play one guess
    // against every live code in the café.
    await register('someone-else@example.test');
    const code = await requestCode('someone-else@example.test');

    const response = await send(app, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });
    expect(response.statusCode).toBe(400);
  });

  it('is single-use', async () => {
    const code = await requestCode();
    const first = await send(app, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });
    const second = await send(app, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
  });

  it('burns the code after the attempt limit, durably', async () => {
    const code = await requestCode();
    for (let i = 0; i < RECOVERY_MAX_ATTEMPTS; i += 1) {
      await send(app, {}, {
        method: 'POST',
        url: '/recovery/consume',
        payload: { email: EMAIL, code: 'ZZZZZZ' },
      });
    }

    // A restart clears the in-memory limiter but not the database, which is the
    // whole reason the `attempts` column exists. Rebuild the limiters and check.
    const fresh = createAuthDeps({ db, store, cookieSecure: true, mailer });
    const restarted = buildServer({ logLevel: 'silent', auth: fresh });
    await restarted.ready();
    const response = await send(restarted, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });
    await restarted.close();

    expect(response.statusCode).toBe(400);
  });

  it('locks out a caller grinding codes against one address', async () => {
    const code = await requestCode();
    const statuses: number[] = [];
    for (let i = 0; i < RECOVERY_MAX_ATTEMPTS + 1; i += 1) {
      const response = await send(app, {}, {
        method: 'POST',
        url: '/recovery/consume',
        payload: { email: EMAIL, code: 'ZZZZZZ' },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses[statuses.length - 1]).toBe(429);
    // And the genuine code is refused too — the lockout is on the address, not
    // on the guess.
    const genuine = await send(app, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });
    expect(genuine.statusCode).toBe(429);
  });

  it('limits how often one address can be mailed', async () => {
    // Recovery is an unauthenticated route that sends mail to somebody else's
    // inbox; without a cap it is a way to bombard a customer.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await send(app, {}, {
        method: 'POST',
        url: '/recovery/request',
        payload: { email: EMAIL },
      });
      statuses.push(response.statusCode);
    }
    await deps.background.drain();

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(mailer.outbox.length).toBeLessThanOrEqual(3);
  });

  it('counts an address the same however it is capitalized', async () => {
    for (const variant of [EMAIL, EMAIL.toUpperCase(), ` ${EMAIL} `]) {
      await send(app, {}, { method: 'POST', url: '/recovery/request', payload: { email: variant } });
    }
    const fourth = await send(app, {}, {
      method: 'POST',
      url: '/recovery/request',
      payload: { email: EMAIL.toUpperCase() },
    });
    await deps.background.drain();

    expect(fourth.statusCode).toBe(429);
  });
});

describe('a till is not a customer’s device', () => {
  it('refuses a consume from a staff session', async () => {
    // The same refusal `PUT /me` makes: a terminal that quietly became a
    // customer's device would be recognised as that customer on its next boot.
    const code = await requestCode();
    const staffJar = await signIn(app, STAFF.username, STAFF.password);

    const response = await send(app, staffJar, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'staff_device' });
  });

  it('leaves the staff session intact', async () => {
    const code = await requestCode();
    const staffJar = await signIn(app, STAFF.username, STAFF.password);
    const before = staffJar[SESSION_COOKIE];

    await send(app, staffJar, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code },
    });

    expect(staffJar[SESSION_COOKIE]).toBe(before);
    const session = await send(app, staffJar, { method: 'GET', url: '/auth/session' });
    expect(session.json()).toMatchObject({ status: 'active' });
  });
});

describe('PII discipline', () => {
  it('keeps the address out of both responses', async () => {
    const requested = await send(app, {}, {
      method: 'POST',
      url: '/recovery/request',
      payload: { email: EMAIL },
    });
    await deps.background.drain();
    const consumed = await send(app, {}, {
      method: 'POST',
      url: '/recovery/consume',
      payload: { email: EMAIL, code: 'ZZZZZZ' },
    });

    expect(requested.body).not.toContain(EMAIL);
    expect(consumed.body).not.toContain(EMAIL);
  });

  it('never returns the code to the caller — it exists only in the inbox', async () => {
    const response = await send(app, {}, {
      method: 'POST',
      url: '/recovery/request',
      payload: { email: EMAIL },
    });
    await deps.background.drain();
    const code = mailer.last('recovery')?.params.code as string;

    expect(response.body).not.toContain(code);
  });
});
