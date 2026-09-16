/**
 * Server-side detection (BE-S-09).
 *
 * `domain/alerts.ts` has its own unit tests in the SPA suite; what is new here
 * is the wiring, and the wiring is the security property. SCOPE-DECISIONS §3.1
 * reinstated server-written audit *because* the detectors read it — a
 * client-written audit log means the detectors judge fraud using data the
 * person committing it authored. So these tests feed the detector through the
 * store the routes write to, not through a fixture.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { deriveServerAlerts, DETECTION_WINDOW_DAYS } from './detection';
import { migrate } from './migrate';
import { PostgresStore } from './PostgresStore';
import { resetSchema, testPool } from './testing/database';

let db: Db;
let store: PostgresStore;
let staffId: string;
let customerId: string;

const NOW = Date.parse('2026-09-15T12:00:00.000Z');

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);

  staffId = (
    await store.createStaff({
      username: 'barista',
      password: 'barista-password-1',
      name: 'Sam Barista',
      role: 'staff',
    })
  ).id;
  customerId = (
    await store.createCustomer({
      token: 'AAAAAAAAAAAAAAAAAAAAAA',
      displayName: 'Card Holder',
      email: 'holder@example.test',
    })
  ).id;
});

afterEach(async () => {
  await db.end();
});

/** Writes an audit row at a chosen instant, which `appendAudit` cannot do. */
async function auditAt(action: string, at: number): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (id, actor_id, actor_role, action, target_id, timestamp)
     VALUES (gen_random_uuid()::text, $1, 'staff', $2, $3, $4)`,
    [staffId, action, customerId, new Date(at).toISOString()],
  );
}

/** Writes a ledger credit at a chosen instant, for the repeat-target detector. */
async function creditAt(at: number): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_transactions (id, customer_id, type, points, staff_id, timestamp)
     VALUES (gen_random_uuid()::text, $1, 'accrual', 1, $2, $3)`,
    [customerId, staffId, new Date(at).toISOString()],
  );
}

describe('deriveServerAlerts', () => {
  it('finds nothing in an ordinary day’s trading', async () => {
    await creditAt(NOW - 60_000);
    await auditAt('loyalty.accrue', NOW - 60_000);
    expect(await deriveServerAlerts(store, () => NOW)).toEqual([]);
  });

  it('pairs accrue and redeem AUDIT rows to flag self-dealing', async () => {
    // The default is three credit-then-redeem pairs inside 30 seconds. The
    // ledger cannot show this: the rewards rework stopped writing a `redemption`
    // entry, which is why the detector reads the audit log at all.
    for (let i = 0; i < 3; i += 1) {
      const base = NOW - (i + 1) * 60_000;
      await auditAt('loyalty.accrue', base);
      await auditAt('loyalty.redeem', base + 5_000);
    }

    const alerts = await deriveServerAlerts(store, () => NOW);
    expect(alerts.map((alert) => alert.kind)).toEqual(['self-dealing']);
    expect(alerts[0]?.staffId).toBe(staffId);
    expect(alerts[0]?.staffName).toBe('Sam Barista');
  });

  it('does not flag a single close pair', async () => {
    // A customer who qualifies on this purchase and takes the coffee straight
    // away is the normal case, not a finding.
    await auditAt('loyalty.accrue', NOW - 60_000);
    await auditAt('loyalty.redeem', NOW - 55_000);
    expect(await deriveServerAlerts(store, () => NOW)).toEqual([]);
  });

  it('respects the admin’s thresholds', async () => {
    await auditAt('loyalty.accrue', NOW - 60_000);
    await auditAt('loyalty.redeem', NOW - 55_000);
    await auditAt('loyalty.accrue', NOW - 50_000);
    await auditAt('loyalty.redeem', NOW - 45_000);

    expect(await deriveServerAlerts(store, () => NOW)).toEqual([]);
    await store.updateConfig({ selfDealCount: 2 });
    expect(await deriveServerAlerts(store, () => NOW)).toHaveLength(1);
  });

  it('flags a card credited over and over by one staff member', async () => {
    for (let i = 0; i < 4; i += 1) await creditAt(NOW - i * 60_000);
    const alerts = await deriveServerAlerts(store, () => NOW);
    expect(alerts.map((alert) => alert.kind)).toEqual(['repeat-target']);
  });

  it('looks back only as far as the detection window', async () => {
    const old = NOW - (DETECTION_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 4; i += 1) await creditAt(old - i * 60_000);
    for (let i = 0; i < 3; i += 1) {
      await auditAt('loyalty.accrue', old - i * 60_000);
      await auditAt('loyalty.redeem', old - i * 60_000 + 5_000);
    }
    expect(await deriveServerAlerts(store, () => NOW)).toEqual([]);
  });

  it('exempts nobody by role', async () => {
    // Appendix E: both detectors apply to admins too. The detector never reads
    // the actor's role, and this is the test that keeps it that way.
    await db.query("UPDATE staff_accounts SET role = 'admin' WHERE id = $1", [staffId]);
    for (let i = 0; i < 4; i += 1) await creditAt(NOW - i * 60_000);
    expect(await deriveServerAlerts(store, () => NOW)).toHaveLength(1);
  });

  it('drops a finding the admin has dismissed', async () => {
    for (let i = 0; i < 4; i += 1) await creditAt(NOW - i * 60_000);
    const [alert] = await deriveServerAlerts(store, () => NOW);
    expect(alert).toBeDefined();

    const key = `${alert?.kind}:${alert?.staffId}:${alert?.customerId ?? ''}:${alert?.at}`;
    await store.updateConfig({ dismissedAlerts: [key] });
    expect(await deriveServerAlerts(store, () => NOW)).toEqual([]);
  });
});
