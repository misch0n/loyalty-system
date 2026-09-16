/**
 * `SessionStore` against a real database.
 *
 * Every rule here is one the prototype could only *ask* the client to follow —
 * the idle lock, the revocation epoch, "this account is disabled now". The tests
 * therefore drive the clock rather than the UI: what matters is that the server
 * refuses, not that a timer in the browser noticed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { migrate } from '../migrate.js';
import { PostgresStore } from '../PostgresStore.js';
import { resetSchema, testPool } from '../testing/database.js';
import {
  CUSTOMER_TTL_MS,
  EPHEMERAL_TTL_MS,
  IDLE_LOCK_MS,
  REMEMBERED_TTL_MS,
  SessionStore,
} from './sessions.js';

let db: Db;
let store: PostgresStore;
let sessions: SessionStore;
let clock: number;

beforeAll(async () => {
  db = testPool();
});

afterAll(async () => {
  if (db) await db.end();
});

beforeEach(async () => {
  await resetSchema(db);
  await migrate(db);
  clock = Date.parse('2026-09-15T09:00:00.000Z');
  store = new PostgresStore(db);
  sessions = new SessionStore(db, () => clock);
});

async function makeStaff(over: { role?: 'admin' | 'staff'; pin?: string } = {}) {
  return store.createStaff({
    username: `staff-${Math.random().toString(36).slice(2, 8)}`,
    password: 'correct horse',
    role: over.role ?? 'staff',
    name: 'On Shift',
    pin: over.pin,
  });
}

async function makeCustomer() {
  const suffix = Math.random().toString(36).slice(2, 10);
  return store.createCustomer({
    token: `token-${suffix}`,
    displayName: 'Card Holder',
    email: `holder-${suffix}@cafe.test`,
  });
}

describe('SessionStore — issuing', () => {
  it('stores only the hash of the token it hands out', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, false);

    const { rows } = await db.query<{ token_hash: string; csrf_token_hash: string }>(
      'SELECT token_hash, csrf_token_hash FROM sessions WHERE id = $1',
      [issued.id],
    );
    // A dumped database must not yield a live session.
    expect(rows[0]?.token_hash).not.toBe(issued.token);
    expect(rows[0]?.csrf_token_hash).not.toBe(issued.csrfToken);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives every session a distinct token', async () => {
    const staff = await makeStaff();
    const first = await sessions.issueStaff(staff.id, false);
    const second = await sessions.issueStaff(staff.id, false);
    expect(first.token).not.toBe(second.token);
    expect(first.csrfToken).not.toBe(first.token);
  });

  it('gives a remembered terminal a long life and a one-off sign-in a short one', async () => {
    const staff = await makeStaff();
    const remembered = await sessions.issueStaff(staff.id, true);
    const ephemeral = await sessions.issueStaff(staff.id, false);

    expect(remembered.expiresAt.getTime()).toBe(clock + REMEMBERED_TTL_MS);
    expect(ephemeral.expiresAt.getTime()).toBe(clock + EPHEMERAL_TTL_MS);
  });

  it('stamps the session with the epoch current at issue', async () => {
    const staff = await makeStaff();
    await sessions.revokeAllStaff();
    const issued = await sessions.issueStaff(staff.id, false);
    expect(issued.sessionEpoch).toBe(1);
  });

  it('issues a customer session for a year', async () => {
    const customer = await makeCustomer();
    const issued = await sessions.issueCustomer(customer.id);
    expect(issued.expiresAt.getTime()).toBe(clock + CUSTOMER_TTL_MS);

    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.record.kind).toBe('customer');
    expect(resolved?.record.customerId).toBe(customer.id);
    expect(resolved?.actor).toBeNull();
  });
});

describe('SessionStore — resolving', () => {
  it('resolves a fresh staff session to its actor', async () => {
    const staff = await makeStaff({ role: 'admin' });
    const issued = await sessions.issueStaff(staff.id, true);

    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.state).toBe('active');
    expect(resolved?.actor).toEqual({
      id: staff.id,
      username: staff.username,
      name: 'On Shift',
      role: 'admin',
    });
    expect(resolved?.record.remembered).toBe(true);
  });

  it('refuses an unknown or empty token', async () => {
    expect(await sessions.resolve('nope')).toBeNull();
    expect(await sessions.resolve('')).toBeNull();
  });

  it('locks a remembered terminal that has idled, keeping its identity', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, true);

    clock += IDLE_LOCK_MS + 1;
    const resolved = await sessions.resolve(issued.token);
    // Locked, not gone: the PIN unlock needs to know whose session this is.
    expect(resolved?.state).toBe('locked');
    expect(resolved?.actor?.id).toBe(staff.id);
  });

  it('ends an idle session on a device that was never remembered', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, false);

    clock += IDLE_LOCK_MS + 1;
    expect(await sessions.resolve(issued.token)).toBeNull();
    // And the row is gone, not merely refused.
    expect(await countSessions()).toBe(0);
  });

  it('keeps a session alive while it is being used', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, false);

    for (let i = 0; i < 4; i += 1) {
      clock += IDLE_LOCK_MS - 1_000;
      expect((await sessions.resolve(issued.token))?.state).toBe('active');
      await sessions.touch(issued.id);
    }
  });

  it('ends a session past its absolute expiry even on a remembered terminal', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, true);

    clock += REMEMBERED_TTL_MS + 1;
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  it('never idles out a customer session', async () => {
    // The card recognition IS the feature; a customer who visits fortnightly
    // must still be known. Only staff terminals lock.
    const customer = await makeCustomer();
    const issued = await sessions.issueCustomer(customer.id);

    clock += 14 * 24 * 60 * 60 * 1000;
    expect((await sessions.resolve(issued.token))?.state).toBe('active');
  });

  it('drops a staff session the moment its account is disabled', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, true);

    await store.setStaffActive(staff.id, false);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  it('drops a staff session when its account is deleted', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, true);

    await store.deleteStaff(staff.id);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });
});

describe('SessionStore — revocation', () => {
  it('bumps the epoch by one rather than writing a timestamp', async () => {
    // `program_config.session_epoch` is an int4; the prototype's `Date.now()`
    // would overflow it. Monotonic is all the comparison needs.
    expect(await sessions.revokeAllStaff()).toBe(1);
    expect(await sessions.revokeAllStaff()).toBe(2);
    expect(await sessions.currentEpoch()).toBe(2);
  });

  it('signs every staff device out, including the admin who pressed it', async () => {
    const admin = await makeStaff({ role: 'admin' });
    const other = await makeStaff();
    const adminSession = await sessions.issueStaff(admin.id, true);
    const otherSession = await sessions.issueStaff(other.id, true);

    await sessions.revokeAllStaff();

    expect(await sessions.resolve(adminSession.token)).toBeNull();
    expect(await sessions.resolve(otherSession.token)).toBeNull();
  });

  it('leaves customer cards recognised', async () => {
    // "Sign out all devices" is about staff terminals. Un-issuing every
    // customer's card would be a different, much larger action.
    const customer = await makeCustomer();
    const card = await sessions.issueCustomer(customer.id);

    await sessions.revokeAllStaff();
    expect((await sessions.resolve(card.token))?.record.customerId).toBe(customer.id);
  });

  it('refuses a session stamped with a superseded epoch', async () => {
    // Belt and braces: the DELETE already removed the row. This covers a session
    // that was in flight, or restored from a backup, with a stale epoch.
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, true);
    await db.query("UPDATE program_config SET session_epoch = 7 WHERE id = 'singleton'");

    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  it('revokes one device without touching the others', async () => {
    const staff = await makeStaff();
    const till = await sessions.issueStaff(staff.id, true);
    const phone = await sessions.issueStaff(staff.id, false);

    await sessions.revoke(phone.id);

    expect(await sessions.resolve(phone.token)).toBeNull();
    expect(await sessions.resolve(till.token)).not.toBeNull();
  });
});

describe('SessionStore — CSRF token', () => {
  it('accepts the token it issued', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, false);
    expect(await sessions.verifyCsrf(issued.id, issued.csrfToken)).toBe(true);
  });

  it('refuses a missing, wrong, or differently-sized token', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, false);

    expect(await sessions.verifyCsrf(issued.id, undefined)).toBe(false);
    expect(await sessions.verifyCsrf(issued.id, '')).toBe(false);
    expect(await sessions.verifyCsrf(issued.id, 'wrong')).toBe(false);
  });

  it('refuses a token minted for a different session', async () => {
    // The double-submit token is bound to its session; without that, any signed-in
    // user's token would unlock any other user's requests.
    const staff = await makeStaff();
    const first = await sessions.issueStaff(staff.id, false);
    const second = await sessions.issueStaff(staff.id, false);

    expect(await sessions.verifyCsrf(first.id, second.csrfToken)).toBe(false);
  });

  it('refuses a token for a session that no longer exists', async () => {
    const staff = await makeStaff();
    const issued = await sessions.issueStaff(staff.id, false);
    await sessions.revoke(issued.id);

    expect(await sessions.verifyCsrf(issued.id, issued.csrfToken)).toBe(false);
  });
});

describe('SessionStore — housekeeping', () => {
  it('sweeps expired rows and keeps live ones', async () => {
    const staff = await makeStaff();
    const short = await sessions.issueStaff(staff.id, false);
    const long = await sessions.issueStaff(staff.id, true);

    clock += EPHEMERAL_TTL_MS + 1;
    expect(await sessions.sweepExpired()).toBe(1);

    expect(await countSessions()).toBe(1);
    expect(short.id).not.toBe(long.id);
  });
});

async function countSessions(): Promise<number> {
  const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM sessions');
  return Number(rows[0]?.count ?? 0);
}
