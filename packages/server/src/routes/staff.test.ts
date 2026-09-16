/**
 * Staff account management over HTTP.
 *
 * The two claims worth testing are the ones a passing CRUD suite would not
 * cover: **no credential ever leaves the server** (§4-A, and the reason
 * `GET /staff/by-username` does not exist), and **the system cannot be locked
 * out of itself** — the guards `StaffService.remove` keeps on the client, plus
 * the disable case the prototype never guarded.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuditLogEntry, StaffAccount } from '@cafe/shared/domain/models';
import { createAuthDeps, type AuthDeps } from '../auth/guards.js';
import type { Db } from '../db.js';
import { migrate } from '../migrate.js';
import { PostgresStore } from '../PostgresStore.js';
import { buildServer } from '../server.js';
import { resetSchema, testPool } from '../testing/database.js';
import { send, signIn, type Jar } from '../testing/http.js';

const ADMIN = { username: 'owner', password: 'owner-password-1', pin: '1111' };
const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let adminId: string;
let staffId: string;
let admin: Jar;

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: true });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();

  adminId = (await store.createStaff({ ...ADMIN, role: 'admin' })).id;
  staffId = (await store.createStaff({ ...STAFF, role: 'staff' })).id;
  admin = await signIn(app, ADMIN.username, ADMIN.password);
});

afterEach(async () => {
  await app.close();
  await db.end();
});

async function auditRows(action: AuditLogEntry['action']): Promise<AuditLogEntry[]> {
  return store.listAudit({ action });
}

describe('GET /staff', () => {
  it('never serializes a credential', async () => {
    const response = await send(app, admin, { method: 'GET', url: '/staff' });
    const accounts = response.json() as StaffAccount[];
    expect(accounts).toHaveLength(2);

    for (const account of accounts) {
      expect(account.passwordHash).toBe('');
      expect(account.pin).toBeUndefined();
    }
    // Belt and braces: the argon2id digests are in the database, and not one
    // character of either appears in what went over the wire.
    const stored = await store.listStaff();
    for (const account of stored) {
      expect(response.body).not.toContain(account.passwordHash);
      if (account.pin) expect(response.body).not.toContain(account.pin);
    }
  });

  it('has no by-username lookup — that route would return the digests', async () => {
    const response = await send(app, admin, {
      method: 'GET',
      url: `/staff/by-username/${ADMIN.username}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('has no by-pin lookup — that route would be a credential oracle (§4-B)', async () => {
    const response = await send(app, admin, {
      method: 'POST',
      url: '/staff/by-pin',
      payload: { pin: ADMIN.pin },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /staff', () => {
  it('creates an account whose password works immediately', async () => {
    const response = await send(app, admin, {
      method: 'POST',
      url: '/staff',
      payload: {
        username: 'newhire',
        password: 'newhire-password-1',
        role: 'staff',
        name: 'New Hire',
        pin: '4321',
      },
    });
    expect(response.statusCode).toBe(201);

    const jar = await signIn(app, 'newhire', 'newhire-password-1');
    const session = await send(app, jar, { method: 'GET', url: '/auth/session' });
    expect((session.json() as { status: string }).status).toBe('active');
  });

  it('hashes the password rather than storing what it was sent (§4-A)', async () => {
    await send(app, admin, {
      method: 'POST',
      url: '/staff',
      payload: { username: 'hashed', password: 'hashed-password-1', role: 'staff' },
    });
    const account = await store.getStaffByUsername('hashed');
    expect(account?.passwordHash).not.toBe('hashed-password-1');
    expect(account?.passwordHash.startsWith('$argon2id$')).toBe(true);

    // The decisive form of the same claim: if the server compared instead of
    // verifying, the stored digest would itself be a working password.
    const jar: Jar = {};
    const asDigest = await send(app, jar, {
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'hashed', password: account?.passwordHash },
    });
    expect(asDigest.statusCode).toBe(401);
  });

  it('refuses a username already taken', async () => {
    const response = await send(app, admin, {
      method: 'POST',
      url: '/staff',
      payload: { username: STAFF.username, password: 'another-password-1', role: 'staff' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'username_taken' });
  });

  it('allows a PIN another account already uses (SCOPE-DECISIONS §3.6)', async () => {
    // Uniqueness is not implementable against hashed PINs and is no longer
    // needed: `/auth/unlock` verifies against an account the session names.
    const response = await send(app, admin, {
      method: 'POST',
      url: '/staff',
      payload: {
        username: 'twin',
        password: 'twin-password-1',
        role: 'staff',
        pin: STAFF.pin,
      },
    });
    expect(response.statusCode).toBe(201);
  });

  it('audits the creation from the session actor', async () => {
    await send(app, admin, {
      method: 'POST',
      url: '/staff',
      payload: { username: 'audited', password: 'audited-password-1', role: 'admin' },
    });
    const rows = await auditRows('staff.create');
    expect(rows[0]?.actorId).toBe(adminId);
    expect(rows[0]?.details).toBe('admin');
  });
});

describe('PATCH /staff/:id', () => {
  it('ends a disabled account’s live sessions at once, not at next sign-in', async () => {
    const staff = await signIn(app, STAFF.username, STAFF.password);
    expect((await send(app, staff, { method: 'GET', url: '/config' })).statusCode).toBe(200);

    await send(app, admin, {
      method: 'PATCH',
      url: `/staff/${staffId}`,
      payload: { active: false },
    });

    expect((await send(app, staff, { method: 'GET', url: '/config' })).statusCode).toBe(401);
    expect((await auditRows('staff.disable'))[0]?.targetId).toBe(staffId);
  });

  it('refuses to disable the signed-in account', async () => {
    const response = await send(app, admin, {
      method: 'PATCH',
      url: `/staff/${adminId}`,
      payload: { active: false },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'cannot_disable_self' });
  });

  /**
   * The invariant behind the self-guard, asserted as an invariant rather than
   * as an error code: no sequence of permitted account operations can leave the
   * café with nobody able to administer it. "Refuses to disable the last admin"
   * is not testable here because it is not *reachable* — the caller is always an
   * active admin who is not the target, so the target is never the last.
   */
  it('always leaves an active admin standing, however many are removed', async () => {
    const deputy = await store.createStaff({
      username: 'deputy',
      password: 'deputy-password-1',
      role: 'admin',
    });
    const deputyJar = await signIn(app, 'deputy', 'deputy-password-1');

    // The deputy removes every other account it can: the original admin and the
    // barista, by disabling one and deleting the other.
    expect(
      (
        await send(app, deputyJar, {
          method: 'PATCH',
          url: `/staff/${adminId}`,
          payload: { active: false },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await send(app, deputyJar, { method: 'DELETE', url: `/staff/${staffId}` })).statusCode,
    ).toBe(204);

    // Now it tries to remove itself, both ways.
    for (const attempt of [
      { method: 'PATCH' as const, url: `/staff/${deputy.id}`, payload: { active: false } },
      { method: 'DELETE' as const, url: `/staff/${deputy.id}` },
    ]) {
      expect((await send(app, deputyJar, attempt)).statusCode).toBe(409);
    }

    const active = (await store.listStaff()).filter((a) => a.role === 'admin' && a.active);
    expect(active.map((a) => a.id)).toEqual([deputy.id]);
  });
});

describe('PATCH /staff/:id/password and /pin', () => {
  it('replaces the password with one that works', async () => {
    const response = await send(app, admin, {
      method: 'PATCH',
      url: `/staff/${staffId}/password`,
      payload: { password: 'brand-new-password-1' },
    });
    expect(response.statusCode).toBe(204);

    const jar = await signIn(app, STAFF.username, 'brand-new-password-1');
    expect((await send(app, jar, { method: 'GET', url: '/config' })).statusCode).toBe(200);

    const old: Jar = {};
    const stale = await send(app, old, {
      method: 'POST',
      url: '/auth/login',
      payload: { username: STAFF.username, password: STAFF.password },
    });
    expect(stale.statusCode).toBe(401);
  });

  it('audits a PIN reset without recording the PIN', async () => {
    await send(app, admin, {
      method: 'PATCH',
      url: `/staff/${staffId}/pin`,
      payload: { pin: '8888' },
    });
    const rows = await auditRows('staff.resetPassword');
    expect(rows[0]?.details).toBe('pin');
    expect(rows[0]?.details).not.toContain('8888');
  });

  it('refuses a PIN that is not 4–8 digits', async () => {
    for (const pin of ['12', 'abcd', '1234567890']) {
      const response = await send(app, admin, {
        method: 'PATCH',
        url: `/staff/${staffId}/pin`,
        payload: { pin },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('DELETE /staff/:id', () => {
  it('removes the account but keeps its ledger and audit attribution', async () => {
    await store.appendAudit({ actorId: staffId, actorRole: 'staff', action: 'staff.login' });

    const response = await send(app, admin, { method: 'DELETE', url: `/staff/${staffId}` });
    expect(response.statusCode).toBe(204);
    expect(await store.getStaffByUsername(STAFF.username)).toBeNull();

    // Neither the ledger nor the audit log carries a foreign key to
    // `staff_accounts`, precisely so history survives a departure.
    const rows = await store.listAudit({ actorId: staffId });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('stops a deleted account’s live session on its next request', async () => {
    const staff = await signIn(app, STAFF.username, STAFF.password);
    await send(app, admin, { method: 'DELETE', url: `/staff/${staffId}` });
    expect((await send(app, staff, { method: 'GET', url: '/config' })).statusCode).toBe(401);
  });

  it('refuses to delete the signed-in account', async () => {
    const response = await send(app, admin, { method: 'DELETE', url: `/staff/${adminId}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'cannot_delete_self' });
    expect(await store.getStaffByUsername(ADMIN.username)).not.toBeNull();
  });
});
