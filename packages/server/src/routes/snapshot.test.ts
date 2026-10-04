/**
 * Backup and restore.
 *
 * Two things are being pinned down. First, that the export is not a credential
 * dump: a backup file travels to laptops and cloud drives, and one carrying
 * every argon2id digest in the café is a leak in waiting. Second, that the
 * import — the one authenticated operation that can destroy the ledger — leaves
 * a record of itself in the *operator's* trail before it runs.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Customer, Snapshot } from '@cafe/shared/domain/models';
import { createAuthDeps, type AuthDeps } from '../auth/guards.js';
import type { Db } from '../db.js';
import { migrate } from '../migrate.js';
import { PostgresStore } from '../PostgresStore.js';
import { buildServer } from '../server.js';
import { resetSchema, testPool } from '../testing/database.js';
import { send, signIn, type Jar } from '../testing/http.js';

const ADMIN = { username: 'owner', password: 'owner-password-1' };

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let admin: Jar;

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: true });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();
  await store.createStaff({ ...ADMIN, role: 'admin' });
  admin = await signIn(app, ADMIN.username, ADMIN.password);
});

afterEach(async () => {
  await app.close();
  await db.end();
});

async function register(email: string): Promise<Customer> {
  const response = await send(app, {}, {
    method: 'POST',
    url: '/customers',
    payload: { displayName: 'Card Holder', email },
  });
  return response.json() as Customer;
}

describe('GET /export', () => {
  it('carries the config, the cards and the ledger', async () => {
    const customer = await register('exported@example.test');
    const response = await send(app, admin, { method: 'GET', url: '/export' });
    const snapshot = response.json() as Snapshot;

    expect(snapshot.config.pointsPerReward).toBe(9);
    expect(snapshot.customers.map((c) => c.id)).toContain(customer.id);
    expect(snapshot.staff).toHaveLength(1);
  });

  it('is not a credential dump', async () => {
    const response = await send(app, admin, { method: 'GET', url: '/export' });
    const stored = await store.listStaff();
    for (const account of stored) {
      expect(response.body).not.toContain(account.passwordHash);
    }
    expect((response.json() as Snapshot).staff[0]?.passwordHash).toBe('');
    // The PIN is gone (SCOPE-DECISIONS §6.3): no staff record carries one.
    expect((response.json() as Snapshot).staff[0]).not.toHaveProperty('pin');
  });

  it('records that it happened', async () => {
    await send(app, admin, { method: 'GET', url: '/export' });
    const rows = await store.listAudit({ action: 'config.update' });
    expect(rows.map((row) => row.details)).toContain('export');
  });
});

describe('POST /import', () => {
  it('replaces the data and audits the attempt first', async () => {
    const original = await register('before@example.test');
    const snapshot = (await send(app, admin, { method: 'GET', url: '/export' })).json() as Snapshot;

    await register('after@example.test');
    expect((await store.listStaff()).length).toBe(1);

    const response = await send(app, admin, { method: 'POST', url: '/import', payload: snapshot });
    expect(response.statusCode).toBe(204);

    const customers = (await store.exportAll()).customers;
    expect(customers.map((c) => c.id)).toEqual([original.id]);
  });

  it('restores a legacy snapshot whose staff records still carry a PIN', async () => {
    // Snapshots exported before UI-1b could carry `pin` on a staff record. The
    // field has no column any more; it is ignored, and the rest restores.
    const snapshot = (await send(app, admin, { method: 'GET', url: '/export' })).json() as Snapshot;
    const legacy = {
      ...snapshot,
      staff: snapshot.staff.map((account) => ({ ...account, pin: '$argon2id$legacy-digest' })),
    };

    const response = await send(app, admin, { method: 'POST', url: '/import', payload: legacy });
    expect(response.statusCode).toBe(204);

    const restored = await store.listStaff();
    expect(restored.map((account) => account.username)).toEqual([ADMIN.username]);
    expect(restored[0]).not.toHaveProperty('pin');
  });

  it('refuses a body that is not a snapshot', async () => {
    const response = await send(app, admin, {
      method: 'POST',
      url: '/import',
      payload: { version: 6 },
    });
    expect(response.statusCode).toBe(400);
  });
});
