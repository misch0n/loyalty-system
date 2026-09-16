/**
 * Activity, alerts and the bounded reads.
 *
 * The headline assertion is a negative one, and it is the acceptance criterion
 * BACKEND-PLAN §6 words as *"cross-account activity has no endpoint"*: whatever
 * a caller asks `GET /audit` for, it gets its own rows. There is no filter, no
 * tier and no parameter that widens it — which is why the test asks in every
 * way the client's own `AuditFilter` can express.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuditLogEntry, Customer, LoyaltyTransaction } from '@cafe/shared/domain/models';
import { createAuthDeps, type AuthDeps } from '../auth/guards.js';
import type { Db } from '../db.js';
import { migrate } from '../migrate.js';
import { PostgresStore } from '../PostgresStore.js';
import { buildServer } from '../server.js';
import { resetSchema, testPool } from '../testing/database.js';
import { send, signIn, type Jar } from '../testing/http.js';

const ADMIN = { username: 'owner', password: 'owner-password-1', pin: '1111' };
const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };
const OTHER = { username: 'colleague', password: 'colleague-password-1', pin: '3333' };

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let staffId: string;
let otherId: string;
let admin: Jar;
let staff: Jar;

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: true });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();

  await store.createStaff({ ...ADMIN, role: 'admin' });
  staffId = (await store.createStaff({ ...STAFF, role: 'staff' })).id;
  otherId = (await store.createStaff({ ...OTHER, role: 'staff' })).id;

  admin = await signIn(app, ADMIN.username, ADMIN.password);
  staff = await signIn(app, STAFF.username, STAFF.password);
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

describe('GET /audit', () => {
  it('returns the caller’s own rows however the filter is phrased', async () => {
    const customer = await register('audited@example.test');
    await store.appendAudit({
      actorId: otherId,
      actorRole: 'staff',
      action: 'loyalty.accrue',
      targetId: customer.id,
      details: 'another actor’s row',
    });
    await send(app, staff, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload: { pointsDelta: 1, redeemRewardIds: [], idempotencyKey: 'audit-key-0001', source: 'a' },
    });

    // Every shape `AuditFilter` offers for naming an actor, including asking for
    // a colleague by id and asking for everyone at once.
    for (const query of [
      '',
      `?actorId=${otherId}`,
      `?actorIds=${otherId}`,
      `?actorIds=${otherId},${staffId}`,
      `?action=loyalty.accrue&actorId=${otherId}`,
    ]) {
      const response = await send(app, staff, { method: 'GET', url: `/audit${query}` });
      expect(response.statusCode).toBe(200);
      const rows = response.json() as AuditLogEntry[];
      expect(rows.length).toBeGreaterThan(0);
      expect([...new Set(rows.map((row) => row.actorId))]).toEqual([staffId]);
    }
  });

  it('gives an admin no wider view than anybody else', async () => {
    await store.appendAudit({ actorId: staffId, actorRole: 'staff', action: 'loyalty.accrue' });
    const response = await send(app, admin, { method: 'GET', url: `/audit?actorIds=${staffId}` });
    const rows = response.json() as AuditLogEntry[];
    expect(rows.every((row) => row.actorId !== staffId)).toBe(true);
  });

  it('caps the number of rows a caller may ask for', async () => {
    const response = await send(app, staff, { method: 'GET', url: '/audit?limit=100000' });
    expect(response.statusCode).toBe(400);
  });

  it('narrows by action and by time as the counter needs', async () => {
    const customer = await register('ranged@example.test');
    await send(app, staff, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload: { pointsDelta: 1, redeemRewardIds: [], idempotencyKey: 'audit-key-0002', source: 'a' },
    });

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await send(app, staff, {
      method: 'GET',
      url: `/audit?action=loyalty.accrue&from=${hourAgo}&limit=10`,
    });
    expect((recent.json() as AuditLogEntry[]).map((r) => r.action)).toEqual(['loyalty.accrue']);

    const ancient = await send(app, staff, {
      method: 'GET',
      url: '/audit?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z',
    });
    expect(ancient.json()).toEqual([]);
  });

  it('has no export route, audited or otherwise (§4-F)', async () => {
    for (const url of ['/audit/export', '/activity/export', '/export/activity']) {
      const response = await send(app, admin, { method: 'POST', url, payload: { reason: 'x' } });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe('POST /audit', () => {
  it('accepts the call and writes nothing (§4-C)', async () => {
    const before = (await store.listAudit({})).length;
    const response = await send(app, staff, {
      method: 'POST',
      url: '/audit',
      payload: {
        // The whole point: a client naming its own actor, role and action.
        actorId: otherId,
        actorRole: 'admin',
        action: 'loyalty.redeem',
        targetId: 'anything',
      },
    });
    expect(response.statusCode).toBe(204);
    expect((await store.listAudit({})).length).toBe(before);
  });
});

describe('GET /alerts', () => {
  it('returns findings, not rows', async () => {
    const response = await send(app, admin, { method: 'GET', url: '/alerts' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('flags a staff member who keeps crediting the same card', async () => {
    const customer = await register('target@example.test');
    // The repeat-target default is "more than 3 credits in 30 minutes".
    for (let i = 0; i < 4; i += 1) {
      await send(app, staff, {
        method: 'POST',
        url: `/customers/${customer.id}/commit`,
        payload: {
          pointsDelta: 1,
          redeemRewardIds: [],
          idempotencyKey: `repeat-key-${i}`,
          source: 'a',
        },
      });
    }

    const response = await send(app, admin, { method: 'GET', url: '/alerts' });
    const alerts = response.json() as { kind: string; staffId: string }[];
    expect(alerts.map((alert) => alert.kind)).toContain('repeat-target');
    expect(alerts[0]?.staffId).toBe(staffId);
  });

  it('stops flagging once the admin dismisses the finding', async () => {
    const customer = await register('dismissed@example.test');
    for (let i = 0; i < 4; i += 1) {
      await send(app, staff, {
        method: 'POST',
        url: `/customers/${customer.id}/commit`,
        payload: {
          pointsDelta: 1,
          redeemRewardIds: [],
          idempotencyKey: `dismiss-key-${i}`,
          source: 'a',
        },
      });
    }
    const alerts = (
      await send(app, admin, { method: 'GET', url: '/alerts' })
    ).json() as { kind: string; staffId: string; customerId?: string; at: string }[];
    const first = alerts[0];
    expect(first).toBeDefined();

    const key = `${first?.kind}:${first?.staffId}:${first?.customerId ?? ''}:${first?.at}`;
    await send(app, admin, {
      method: 'PATCH',
      url: '/config',
      payload: { dismissedAlerts: [key] },
    });

    const after = await send(app, admin, { method: 'GET', url: '/alerts' });
    expect(after.json()).toEqual([]);
  });
});

describe('GET /transactions', () => {
  it('requires a range and reports truncation rather than hiding it (§4-E)', async () => {
    const customer = await register('ledger@example.test');
    for (let i = 0; i < 3; i += 1) {
      await send(app, staff, {
        method: 'POST',
        url: `/customers/${customer.id}/transactions`,
        payload: { type: 'accrual', points: 1 },
      });
    }

    const noRange = await send(app, admin, { method: 'GET', url: '/transactions' });
    expect(noRange.statusCode).toBe(400);

    const wide = await send(app, admin, {
      method: 'GET',
      url: '/transactions?from=2000-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z',
    });
    expect(wide.json()).toEqual({ error: 'range_too_wide' });

    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const page = await send(app, admin, {
      method: 'GET',
      url: `/transactions?from=${from}&to=${to}&limit=2`,
    });
    const body = page.json() as { transactions: LoyaltyTransaction[]; truncated: boolean };
    expect(body.transactions).toHaveLength(2);
    expect(body.truncated).toBe(true);
  });

  it('refuses a backwards range', async () => {
    const response = await send(app, admin, {
      method: 'GET',
      url: '/transactions?from=2026-06-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
    });
    expect(response.json()).toEqual({ error: 'invalid_range' });
  });
});

describe('GET /stats/active-customers', () => {
  it('counts active cards and forgets tombstoned ones', async () => {
    const first = await register('one@example.test');
    await register('two@example.test');
    expect((await send(app, admin, { method: 'GET', url: '/stats/active-customers' })).json()).toBe(2);

    await send(app, admin, { method: 'DELETE', url: `/customers/${first.id}` });
    expect((await send(app, admin, { method: 'GET', url: '/stats/active-customers' })).json()).toBe(1);
  });
});
