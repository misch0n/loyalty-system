/**
 * IndexedDB-SPECIFIC behaviour of the prototype `DataStore` adapter.
 *
 * The port contract itself — customers, the ledger, the atomic commit, rewards,
 * staff, config, recovery codes, audit, stats and backup — lives in the shared
 * conformance suite (`tests/conformance/dataStoreConformance.ts`), which runs
 * against this adapter from `IndexedDbStore.conformance.test.ts` and against
 * `PostgresStore` in the server's test run. Keeping it in one place is what
 * makes "both stores behave the same" a fact rather than a hope.
 *
 * What stays here is everything that is only true of IndexedDB: the prototype
 * seed, the short-code backfill, the clean-reset upgrade and the self-heal that
 * rescue a wedged database, `reset()`, and the retired `redeemReward` path the
 * production schema deliberately refuses.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDbStore } from '../../src/adapters/storage/IndexedDbStore';
import { DB_NAME, DEFAULT_CONFIG } from '../../src/adapters/storage/schema';

let store: IndexedDbStore;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store = new IndexedDbStore();
});

describe('seed', () => {
  it('seeds the default config and the mock staff accounts', async () => {
    expect(await store.getConfig()).toEqual(DEFAULT_CONFIG);
    const staff = await store.listStaff();
    expect(staff.map((s) => s.username)).toEqual(['admin', 'priya', 'staff']);
  });

  it('does not seed demo customers unless asked (off by default in tests)', async () => {
    expect(await store.countActiveCustomers()).toBe(0);
    expect(await store.listAllTransactions()).toEqual([]);
  });

  it('is idempotent — reopening does not overwrite edited config or duplicate staff', async () => {
    await store.updateConfig({ pointsPerReward: 5 });
    await store.createStaff({ username: 'extra', passwordHash: 'pw', role: 'staff' });

    // Reopen the SAME database (do not reset the factory).
    const reopened = new IndexedDbStore();
    expect((await reopened.getConfig()).pointsPerReward).toBe(5);
    expect((await reopened.listStaff()).map((s) => s.username)).toEqual([
      'admin',
      'extra',
      'priya',
      'staff',
    ]);
  });
});

describe('short-code backfill', () => {
  it('backfills a short code onto a pre-v4 customer on open', async () => {
    const c = await store.createCustomer({ token: 'tok-bf' });
    // Simulate a legacy row with no shortCode.
    const snap = await store.exportAll();
    snap.customers = snap.customers.map((x) => ({ ...x, shortCode: undefined as unknown as string }));
    await store.importAll(snap);
    expect((await store.getCustomerById(c.id))?.shortCode).toBeUndefined();
    // Reopening runs the post-open backfill (not the versionchange upgrade).
    const reopened = new IndexedDbStore();
    expect((await reopened.getCustomerById(c.id))?.shortCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});

describe('redeemReward — the retired pre-rework path', () => {
  // Kept here rather than in the conformance suite because the two stores
  // genuinely differ: the rewards-as-objects rework replaced this call with
  // `commitCounterTransaction`, and the production schema refuses the
  // `'redemption'` ledger entry it writes (see `PostgresStore.redeemReward`).
  // Both go in Phase 11 with the rest of the transitional surface.
  beforeEach(async () => {
    await store.updateConfig({ pointsPerReward: 8 });
  });

  it('redeems atomically when the balance meets the threshold', async () => {
    const c = await store.createCustomer({ token: 't' });
    await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 8, staffId: 's' });
    const ok = await store.redeemReward(c.id, 's');
    expect(ok.ok).toBe(true);
    expect(ok.balance).toBe(0);
    expect(ok.transaction?.type).toBe('redemption');
    expect(ok.transaction?.points).toBe(-8);
  });

  it('refuses redemption below the threshold and reports the balance', async () => {
    const c = await store.createCustomer({ token: 't' });
    await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 3, staffId: 's' });
    const result = await store.redeemReward(c.id, 's');
    expect(result.ok).toBe(false);
    expect(result.balance).toBe(3);
  });

  it('cannot double-spend across concurrent redemptions', async () => {
    const c = await store.createCustomer({ token: 't' });
    await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 10, staffId: 's' });
    const [a, b] = await Promise.all([
      store.redeemReward(c.id, 's'),
      store.redeemReward(c.id, 's'),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('migration & recovery (v5 clean reset + the "everything stuck" hang)', () => {
  /** Build a pre-v5 (v3) database by hand, holding a legacy customer. */
  async function makeV3DatabaseWithLegacyCustomer(): Promise<void> {
    const db = await openDB(DB_NAME, 3, {
      upgrade(database) {
        database.createObjectStore('config', { keyPath: 'id' });
        const staff = database.createObjectStore('staff', { keyPath: 'id' });
        staff.createIndex('byUsername', 'username', { unique: true });
        const customers = database.createObjectStore('customers', { keyPath: 'id' });
        customers.createIndex('byToken', 'token', { unique: true });
        customers.createIndex('byStatus', 'status');
        const transactions = database.createObjectStore('transactions', { keyPath: 'id' });
        transactions.createIndex('byCustomer', 'customerId');
        const audit = database.createObjectStore('audit', { keyPath: 'id' });
        audit.createIndex('byTimestamp', 'timestamp');
        audit.createIndex('byAction', 'action');
        database.createObjectStore('recoveryCodes', { keyPath: 'code' });
      },
    });
    await db.put('customers', {
      id: 'legacy1',
      token: 'legacy-tok',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    db.close();
  }

  it('v5 is a clean reset: an older DB is dropped + recreated, store stays usable', async () => {
    globalThis.indexedDB = new IDBFactory(); // discard the beforeEach v5 store's DB
    await makeV3DatabaseWithLegacyCustomer();

    const migrated = new IndexedDbStore();
    // The clean reset drops the legacy data (no migration — REWARDS-DECISIONS Q2).
    expect(await migrated.getCustomerByToken('legacy-tok')).toBeNull();
    // The fresh v5 seed is present and the new reward stores are live.
    expect((await migrated.listStaff()).map((s) => s.username)).toEqual(['admin', 'priya', 'staff']);
    // And the store is fully usable — this is the exact path that hung in prod
    // (card creation / login awaiting an open that never resolved).
    const created = await migrated.createCustomer({ token: 'after-migration' });
    expect(await migrated.getCustomerByToken('after-migration')).toMatchObject({ id: created.id });
    expect(await migrated.listRewards(created.id)).toEqual([]);
  });

  it('self-heals a wedged/incompatible database (deletes + reopens, never hangs)', async () => {
    globalThis.indexedDB = new IDBFactory(); // discard the beforeEach v4 store's DB
    // A database left at a HIGHER version (an aborted/future build) makes openDB
    // reject. The store must delete + reopen fresh rather than hang every call.
    const future = await openDB(DB_NAME, 99, {
      upgrade(database) {
        database.createObjectStore('config', { keyPath: 'id' });
      },
    });
    future.close();

    const healed = new IndexedDbStore();
    // Fresh seed is back and the store works.
    expect((await healed.listStaff()).map((s) => s.username)).toEqual(['admin', 'priya', 'staff']);
    const created = await healed.createCustomer({ token: 'healed' });
    expect(await healed.getCustomerByToken('healed')).toMatchObject({ id: created.id });
  });
});

describe('reset', () => {
  it('wipes all data, re-seeds, and leaves the SAME instance usable (no reload)', async () => {
    await store.createCustomer({ token: 'gone' });
    await store.updateConfig({ pointsPerReward: 5 });

    await store.reset();

    // Data is gone and the seed is back, on the same instance.
    expect(await store.getCustomerByToken('gone')).toBeNull();
    expect(await store.getConfig()).toEqual(DEFAULT_CONFIG);
    expect((await store.listStaff()).map((s) => s.username)).toEqual(['admin', 'priya', 'staff']);

    // Crucially, the store still works after reset — the bug this fixes was the
    // in-memory store pointing at a deleted DB ("create a card fails until a hard
    // refresh").
    const created = await store.createCustomer({ token: 'fresh' });
    expect(await store.getCustomerByToken('fresh')).toMatchObject({ id: created.id });
  });
});
