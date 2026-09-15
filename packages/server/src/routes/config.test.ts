/**
 * Program configuration over HTTP.
 *
 * `ConfigService.sanitizeConfig` runs in the browser, which makes it
 * presentation rather than enforcement (BACKEND-PLAN §3-B-12). These tests are
 * the enforcement: the same arithmetic, applied where a caller cannot skip it,
 * plus the ceilings the client never needed and the one field a client may not
 * set at all.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProgramConfig } from '@cafe/shared/domain/models';
import { createAuthDeps, type AuthDeps } from '../auth/guards';
import type { Db } from '../db';
import { migrate } from '../migrate';
import { PostgresStore } from '../PostgresStore';
import { buildServer } from '../server';
import { resetSchema, testPool } from '../testing/database';
import { send, signIn, type Jar } from '../testing/http';

const ADMIN = { username: 'owner', password: 'owner-password-1', pin: '1111' };
const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let adminId: string;
let admin: Jar;

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: true });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();

  adminId = (await store.createStaff({ ...ADMIN, passwordHash: ADMIN.password, role: 'admin' })).id;
  await store.createStaff({ ...STAFF, passwordHash: STAFF.password, role: 'staff' });
  admin = await signIn(app, ADMIN.username, ADMIN.password);
});

afterEach(async () => {
  await app.close();
  await db.end();
});

async function patch(payload: Record<string, unknown>) {
  return send(app, admin, { method: 'PATCH', url: '/config', payload });
}

describe('GET /config', () => {
  it('is readable by the counter, which needs the cap and the threshold', async () => {
    const staff = await signIn(app, STAFF.username, STAFF.password);
    const response = await send(app, staff, { method: 'GET', url: '/config' });
    const config = response.json() as ProgramConfig;
    expect(config.pointsPerReward).toBe(9);
    expect(config.maxPointsPerTransaction).toBe(3);
  });
});

describe('PATCH /config', () => {
  it('applies only the fields sent', async () => {
    const before = await store.getConfig();
    const response = await patch({ rewardDescription: '  Free flat white  ' });
    const after = response.json() as ProgramConfig;
    expect(after.rewardDescription).toBe('Free flat white');
    expect(after.pointsPerReward).toBe(before.pointsPerReward);
  });

  it('clamps a value below the floor rather than storing it', async () => {
    const response = await patch({ pointsPerReward: 0, pointsPerPurchase: -5 });
    const config = response.json() as ProgramConfig;
    expect(config.pointsPerReward).toBe(1);
    expect(config.pointsPerPurchase).toBe(1);
  });

  it('clamps a value above the ceiling the client never had', async () => {
    // Unbounded, this would draw a card grid of a million cups.
    const response = await patch({ pointsPerReward: 1_000_000 });
    expect((response.json() as ProgramConfig).pointsPerReward).toBe(100);
  });

  it('floors a fractional value instead of letting the column reject it', async () => {
    const response = await patch({ maxPointsPerTransaction: 4.9 });
    expect((response.json() as ProgramConfig).maxPointsPerTransaction).toBe(4);
  });

  it('keeps a detector count at 2, where the database’s CHECK starts', async () => {
    // A deliberate divergence from `sanitizeConfig`, whose floor is 1. At 1 the
    // self-dealing detector fires on a single ordinary pair, and migration 001
    // refuses the value outright — so clamping to the client's floor would turn
    // an admin's typo into a 500.
    const response = await patch({ selfDealCount: 1, repeatCount: 0 });
    const config = response.json() as ProgramConfig;
    expect(config.selfDealCount).toBe(2);
    expect(config.repeatCount).toBe(2);
  });

  it('refuses a client-supplied sessionEpoch', async () => {
    // Revocation is `POST /auth/logout-all`. Accepting the field would let a
    // client *lower* the epoch and un-revoke what it had just cancelled.
    const before = (await store.getConfig()).sessionEpoch;
    const response = await patch({ sessionEpoch: 0 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'rejected_field' });
    expect((await store.getConfig()).sessionEpoch).toBe(before);
  });

  it('refuses a sessionEpoch even alongside a legitimate change', async () => {
    const response = await patch({ pointsPerReward: 7, sessionEpoch: 99 });
    expect(response.statusCode).toBe(400);
    expect((await store.getConfig()).pointsPerReward).toBe(9);
  });

  it('refuses a patch with nothing recognisable in it', async () => {
    const response = await patch({ notAField: 1 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'empty_patch' });
  });

  it('audits the field names and never the values', async () => {
    await patch({ rewardDescription: 'Free affogato', pointsPerReward: 6 });
    const rows = await store.listAudit({ action: 'config.update' });
    expect(rows[0]?.actorId).toBe(adminId);
    expect(rows[0]?.details).toBe('pointsPerReward,rewardDescription');
    expect(rows[0]?.details).not.toContain('affogato');
  });
});
