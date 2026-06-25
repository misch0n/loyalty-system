/**
 * Direct tests for the prototype DataStore adapter. The services tests already
 * exercise it indirectly; these pin down adapter-specific behaviour: the seed,
 * index-backed lookups, error paths, ordering, atomic redemption and the
 * export/import round-trip.
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

/** Small real delay so successive ISO timestamps are strictly ordered. */
const tick = () => new Promise((r) => setTimeout(r, 5));

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

describe('customers', () => {
  it('creates and resolves a customer by id and by token', async () => {
    const created = await store.createCustomer({ token: 'tok', displayName: 'Maria' });
    expect(await store.getCustomerById(created.id)).toMatchObject({ id: created.id });
    expect(await store.getCustomerByToken('tok')).toMatchObject({ id: created.id });
  });

  it('returns null for unknown id/token', async () => {
    expect(await store.getCustomerById('nope')).toBeNull();
    expect(await store.getCustomerByToken('nope')).toBeNull();
  });

  it('assigns a unique short code on create and resolves by it', async () => {
    const a = await store.createCustomer({ token: 'tok-a' });
    const b = await store.createCustomer({ token: 'tok-b' });
    expect(a.shortCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(a.shortCode).not.toBe(b.shortCode);
    expect(await store.getCustomerByShortCode(a.shortCode)).toMatchObject({ id: a.id });
    expect(await store.getCustomerByShortCode('00000000')).toBeNull();
    expect(await store.getCustomerByShortCode('')).toBeNull();
  });

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

  it('finds active customers by name, email or phone and ignores deleted ones', async () => {
    await store.createCustomer({ token: 't1', displayName: 'Maria', email: 'maria@cafe.test' });
    await store.createCustomer({ token: 't2', phone: '+1 (555) 123-4567' });
    const deleted = await store.createCustomer({ token: 't3', displayName: 'Gone' });
    await store.softDeleteCustomer(deleted.id);

    expect(await store.findCustomers({ term: 'mar' })).toHaveLength(1);
    expect(await store.findCustomers({ term: 'MARIA@CAFE.TEST' })).toHaveLength(1);
    expect(await store.findCustomers({ term: '5551234567' })).toHaveLength(1);
    expect(await store.findCustomers({ term: 'Gone' })).toHaveLength(0);
    expect(await store.findCustomers({ term: '   ' })).toEqual([]);
  });

  it('rotates the token and records consent', async () => {
    const c = await store.createCustomer({ token: 'old' });
    const rotated = await store.rotateToken(c.id, 'new');
    expect(rotated.token).toBe('new');
    const consented = await store.recordConsent(c.id, '2026-01-01T00:00:00.000Z');
    expect(consented.consentAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('soft-deletes: status deleted, PII cleared', async () => {
    const c = await store.createCustomer({
      token: 't',
      displayName: 'Maria',
      email: 'm@cafe.test',
      phone: '555',
    });
    await store.softDeleteCustomer(c.id);
    const after = await store.getCustomerById(c.id);
    expect(after?.status).toBe('deleted');
    expect(after?.displayName).toBeUndefined();
    expect(after?.email).toBeUndefined();
    expect(after?.phone).toBeUndefined();
  });

  it('throws when updating a customer that does not exist', async () => {
    await expect(store.updateCustomer('nope', { displayName: 'x' })).rejects.toThrow();
  });
});

describe('loyalty ledger', () => {
  it('appends transactions and lists them oldest-first', async () => {
    const c = await store.createCustomer({ token: 't' });
    await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 1, staffId: 's' });
    await tick();
    await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 2, staffId: 's' });
    const txs = await store.listTransactions(c.id);
    expect(txs.map((t) => t.points)).toEqual([1, 2]);
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

describe('rewards-as-objects (commitCounterTransaction / undo)', () => {
  let idem = 0;
  const key = () => `idem-${++idem}`;

  /** A counter transaction with the boilerplate filled in. */
  const counter = (over: Partial<Parameters<IndexedDbStore['commitCounterTransaction']>[0]>) => ({
    customerId: 'x',
    pointsDelta: 0,
    redeemRewardIds: [],
    staffId: 's',
    idempotencyKey: key(),
    source: 'a' as const,
    ...over,
  });

  /** Loosen the per-transaction cap so a single commit can cross the threshold. */
  const widenCap = () => store.updateConfig({ maxPointsPerTransaction: 50 });

  it('accrues points and settles the balance below the threshold', async () => {
    const c = await store.createCustomer({ token: 't' });
    const r = await store.commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 3 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.minted).toHaveLength(0);
    expect(r.state.balance).toBe(3);
    expect(r.state.progress).toEqual({ current: 3, threshold: 8, rewardsAvailable: 0 });
  });

  it('mints exactly one reward when an accrual crosses the threshold, balance settles', async () => {
    await widenCap();
    const c = await store.createCustomer({ token: 't' });
    const r = await store.commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 8 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.minted).toHaveLength(1);
    expect(r.minted[0].status).toBe('unspent');
    expect(r.minted[0].token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r.state.balance).toBe(0);
    expect(r.state.rewards).toHaveLength(1);
    // The ledger gained an accrual + a reward_issue(−threshold) entry.
    expect((await store.listTransactions(c.id)).map((t) => t.type).sort()).toEqual([
      'accrual',
      'reward_issue',
    ]);
  });

  it('mints several rewards in one commit when a big accrual crosses twice', async () => {
    await widenCap();
    const c = await store.createCustomer({ token: 't' });
    const r = await store.commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 19 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.minted).toHaveLength(2); // 19 → two rewards, balance settles to 3
    expect(r.state.balance).toBe(3);
    expect(await store.listRewards(c.id, 'unspent')).toHaveLength(2);
  });

  it('is idempotent: a retried commit (same key) returns the same result with no extra writes', async () => {
    const c = await store.createCustomer({ token: 't' });
    const txn = counter({ customerId: c.id, pointsDelta: 3 });
    const first = await store.commitCounterTransaction(txn);
    const second = await store.commitCounterTransaction(txn); // same idempotencyKey
    expect(second).toEqual(first);
    // No double accrual: exactly one ledger entry, balance unchanged.
    expect(await store.listTransactions(c.id)).toHaveLength(1);
    expect((await store.getCustomerState(c.id)).balance).toBe(3);
  });

  it('redeems a reward and reports a stale id without aborting (subset redeem)', async () => {
    await widenCap();
    const c = await store.createCustomer({ token: 't' });
    const minted = await store.commitCounterTransaction(
      counter({ customerId: c.id, pointsDelta: 8 }),
    );
    expect(minted.ok && minted.minted).toBeTruthy();
    if (!minted.ok) return;
    const rewardId = minted.minted[0].id;

    const r = await store.commitCounterTransaction(
      counter({ customerId: c.id, redeemRewardIds: [rewardId, 'ghost-id'] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.redeemed.map((x) => x.id)).toEqual([rewardId]);
    expect(r.rejected).toEqual([{ rewardId: 'ghost-id', reason: 'reward_invalid' }]);
    expect(await store.listRewards(c.id, 'unspent')).toHaveLength(0);
    expect(await store.listRewards(c.id, 'spent')).toHaveLength(1);

    // A second redeem of the same reward is rejected as already_spent.
    const again = await store.commitCounterTransaction(
      counter({ customerId: c.id, redeemRewardIds: [rewardId] }),
    );
    expect(again.ok && again.rejected).toEqual([{ rewardId, reason: 'already_spent' }]);
  });

  it("rejects redeeming another customer's reward as not_owner", async () => {
    await widenCap();
    const a = await store.createCustomer({ token: 'a' });
    const b = await store.createCustomer({ token: 'b' });
    const minted = await store.commitCounterTransaction(
      counter({ customerId: a.id, pointsDelta: 8 }),
    );
    if (!minted.ok) throw new Error('mint failed');
    const r = await store.commitCounterTransaction(
      counter({ customerId: b.id, redeemRewardIds: [minted.minted[0].id] }),
    );
    expect(r.ok && r.rejected).toEqual([
      { rewardId: minted.minted[0].id, reason: 'not_owner' },
    ]);
    // a's reward is untouched.
    expect(await store.listRewards(a.id, 'unspent')).toHaveLength(1);
  });

  it('rejects an over-cap accrual with no writes', async () => {
    const c = await store.createCustomer({ token: 't' });
    const r = await store.commitCounterTransaction(
      counter({ customerId: c.id, pointsDelta: 99 }),
    );
    expect(r).toEqual({ ok: false, error: 'over_cap' });
    expect(await store.listTransactions(c.id)).toHaveLength(0);
  });

  it('rejects a commit for an unknown customer with no writes', async () => {
    const r = await store.commitCounterTransaction(
      counter({ customerId: 'nobody', pointsDelta: 1 }),
    );
    expect(r).toEqual({ ok: false, error: 'customer_not_found' });
  });

  it('undo reverses points and voids a freshly-minted reward', async () => {
    await widenCap();
    const c = await store.createCustomer({ token: 't' });
    const txn = counter({ customerId: c.id, pointsDelta: 8 });
    const committed = await store.commitCounterTransaction(txn);
    if (!committed.ok) throw new Error('commit failed');

    const undo = await store.undoCommit(txn.idempotencyKey);
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    // Minted reward voided, balance back to the pre-commit value.
    expect(await store.listRewards(c.id, 'unspent')).toHaveLength(0);
    expect(await store.listRewards(c.id, 'voided')).toHaveLength(1);
    expect((await store.getCustomerState(c.id)).balance).toBe(0);
  });

  it('undo of a points-only commit reverses the balance', async () => {
    const c = await store.createCustomer({ token: 't' });
    const txn = counter({ customerId: c.id, pointsDelta: 3 });
    await store.commitCounterTransaction(txn);
    await store.undoCommit(txn.idempotencyKey);
    expect((await store.getCustomerState(c.id)).balance).toBe(0);
  });

  it('undo of a redemption re-mints a replacement and leaves the original spent', async () => {
    await widenCap();
    const c = await store.createCustomer({ token: 't' });
    const minted = await store.commitCounterTransaction(
      counter({ customerId: c.id, pointsDelta: 8 }),
    );
    if (!minted.ok) throw new Error('mint failed');
    const original = minted.minted[0].id;

    const redeemTxn = counter({ customerId: c.id, redeemRewardIds: [original] });
    await store.commitCounterTransaction(redeemTxn);
    expect(await store.listRewards(c.id, 'unspent')).toHaveLength(0);

    const undo = await store.undoCommit(redeemTxn.idempotencyKey);
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    // The spent reward STAYS spent; a fresh replacement is minted.
    expect(undo.minted).toHaveLength(1);
    expect(undo.minted[0].id).not.toBe(original);
    expect(await store.listRewards(c.id, 'spent')).toHaveLength(1);
    expect(await store.listRewards(c.id, 'unspent')).toHaveLength(1);
  });

  it('undo is itself idempotent (a second undo replays the cached result)', async () => {
    const c = await store.createCustomer({ token: 't' });
    const txn = counter({ customerId: c.id, pointsDelta: 3 });
    await store.commitCounterTransaction(txn);
    const first = await store.undoCommit(txn.idempotencyKey);
    const second = await store.undoCommit(txn.idempotencyKey);
    expect(second).toEqual(first);
    expect((await store.getCustomerState(c.id)).balance).toBe(0);
  });

  it('undo of an unknown key reports nothing to undo', async () => {
    const r = await store.undoCommit('never-committed');
    expect(r).toEqual({ ok: false, error: 'customer_not_found' });
  });
});

describe('staff & config', () => {
  it('creates and resolves a staff account by username', async () => {
    const created = await store.createStaff({ username: 'bob', passwordHash: 'pw', role: 'staff' });
    expect(created.active).toBe(true);
    expect(await store.getStaffByUsername('bob')).toMatchObject({ id: created.id });
  });

  it('rejects a duplicate username (unique index)', async () => {
    await store.createStaff({ username: 'dup', passwordHash: 'pw', role: 'staff' });
    await expect(
      store.createStaff({ username: 'dup', passwordHash: 'pw2', role: 'staff' }),
    ).rejects.toThrow();
  });

  it('updates active flag and password, and throws on a missing account', async () => {
    const s = await store.createStaff({ username: 'x', passwordHash: 'pw', role: 'staff' });
    await store.setStaffActive(s.id, false);
    await store.setStaffPassword(s.id, 'pw2');
    const after = await store.getStaffByUsername('x');
    expect(after?.active).toBe(false);
    expect(after?.passwordHash).toBe('pw2');
    await expect(store.setStaffActive('nope', false)).rejects.toThrow();
    await expect(store.setStaffPassword('nope', 'pw')).rejects.toThrow();
  });

  it('persists an optional PIN on create and resolves it via getStaffByPin', async () => {
    const s = await store.createStaff({
      username: 'pinner',
      passwordHash: 'pw',
      role: 'staff',
      pin: '5678',
    });
    expect(s.pin).toBe('5678');
    expect(await store.getStaffByPin('5678')).toMatchObject({ id: s.id });
  });

  it('setStaffPin sets/replaces a PIN and throws on a missing account', async () => {
    const s = await store.createStaff({ username: 'setpin', passwordHash: 'pw', role: 'staff' });
    await store.setStaffPin(s.id, '4444');
    expect(await store.getStaffByPin('4444')).toMatchObject({ id: s.id });
    await store.setStaffPin(s.id, '5555');
    expect(await store.getStaffByPin('4444')).toBeNull();
    expect(await store.getStaffByPin('5555')).toMatchObject({ id: s.id });
    await expect(store.setStaffPin('nope', '6666')).rejects.toThrow();
  });

  it('lists staff sorted by username', async () => {
    await store.createStaff({ username: 'zara', passwordHash: 'pw', role: 'staff' });
    await store.createStaff({ username: 'bea', passwordHash: 'pw', role: 'staff' });
    expect((await store.listStaff()).map((s) => s.username)).toEqual([
      'admin',
      'bea',
      'priya',
      'staff',
      'zara',
    ]);
  });

  it('merges config patches without dropping other fields', async () => {
    const updated = await store.updateConfig({ rewardDescription: 'Free pastry' });
    expect(updated.rewardDescription).toBe('Free pastry');
    expect(updated.pointsPerReward).toBe(DEFAULT_CONFIG.pointsPerReward);
  });
});

describe('audit', () => {
  it('filters by action and actorId, limits, and returns newest-first', async () => {
    await store.appendAudit({ actorId: 'a', actorRole: 'admin', action: 'config.update' });
    await tick();
    await store.appendAudit({ actorId: 'b', actorRole: 'staff', action: 'loyalty.accrue' });
    await tick();
    await store.appendAudit({ actorId: 'b', actorRole: 'staff', action: 'loyalty.redeem' });

    const all = await store.listAudit();
    expect(all.map((e) => e.action)).toEqual([
      'loyalty.redeem',
      'loyalty.accrue',
      'config.update',
    ]);
    expect(await store.listAudit({ action: 'loyalty.accrue' })).toHaveLength(1);
    expect(await store.listAudit({ actorId: 'b' })).toHaveLength(2);
    expect(await store.listAudit({ limit: 1 })).toHaveLength(1);
  });
});

describe('stats & backup', () => {
  it('counts active customers and lists all transactions', async () => {
    const a = await store.createCustomer({ token: 'a' });
    const b = await store.createCustomer({ token: 'b' });
    await store.softDeleteCustomer(b.id);
    await store.appendTransaction({ customerId: a.id, type: 'accrual', points: 2, staffId: 's' });
    expect(await store.countActiveCustomers()).toBe(1);
    expect(await store.listAllTransactions()).toHaveLength(1);
  });

  it('exports a snapshot and imports it into a fresh store', async () => {
    const c = await store.createCustomer({ token: 't', displayName: 'Maria' });
    await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 3, staffId: 's' });
    await store.appendAudit({ actorId: 's', actorRole: 'staff', action: 'card.issue' });
    const snapshot = await store.exportAll();

    globalThis.indexedDB = new IDBFactory();
    const fresh = new IndexedDbStore();
    await fresh.importAll(snapshot);

    expect(await fresh.getCustomerByToken('t')).toMatchObject({ displayName: 'Maria' });
    expect(await fresh.listTransactions(c.id)).toHaveLength(1);
    expect(await fresh.listAudit()).toHaveLength(1);
    expect(await fresh.getConfig()).toEqual(snapshot.config);
  });

  it('importAll replaces existing data (clears before writing)', async () => {
    await store.createCustomer({ token: 'will-be-gone' });
    const empty = {
      version: 1,
      exportedAt: new Date().toISOString(),
      config: DEFAULT_CONFIG,
      staff: [],
      customers: [],
      transactions: [],
      audit: [],
    };
    await store.importAll(empty);
    expect(await store.getCustomerByToken('will-be-gone')).toBeNull();
    expect(await store.listStaff()).toEqual([]);
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
