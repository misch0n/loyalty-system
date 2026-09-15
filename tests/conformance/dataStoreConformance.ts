/**
 * The shared `DataStore` conformance suite.
 *
 * One suite, run against every adapter that claims to implement the port:
 * `IndexedDbStore` (prototype, fake-indexeddb) and `PostgresStore` (production,
 * a real database). If both pass, swapping them at the composition root is
 * provably safe — which is the promise the ports architecture makes and the one
 * thing nothing else in the repo actually checks.
 *
 * **What belongs here:** behaviour the port guarantees, phrased so it can be
 * true of any backing store. Nothing about IndexedDB versions, SQL, seeds or
 * connection handling — adapter-specific behaviour stays in that adapter's own
 * test file, next to the thing it is specific to.
 *
 * **Written against the contract, not either implementation.** In particular the
 * suite never assumes an empty store is *completely* empty (the prototype seeds
 * mock staff, a production database does not), and it never inspects how a
 * credential is stored (the prototype keeps a plain value, Postgres an argon2id
 * digest) — only that the behaviour built on it holds.
 *
 * **Deliberately not covered:** `redeemReward`. It is the pre-rework redeem path
 * that writes a `'redemption'` ledger entry; the rewards-as-objects rework
 * replaced it with `commitCounterTransaction`, and the production schema refuses
 * that entry type outright. The two stores genuinely differ there, on purpose —
 * see `PostgresStore.redeemReward`. It goes in Phase 11 with the rest of the
 * transitional surface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CounterTransaction, DataStore } from '../../src/ports/DataStore';
import type { Snapshot } from '../../src/domain/models';

export interface StoreHarness {
  /** Adapter name, used in the suite title. */
  name: string;
  /**
   * A store holding no customers, rewards, ledger entries, audit rows or
   * recovery codes, and the default program config. Seeded staff accounts are
   * allowed — the suite never assumes their absence.
   */
  create(): Promise<DataStore>;
  /** Optional per-test teardown (close a connection, drop a database). */
  dispose?(store: DataStore): Promise<void>;
  /**
   * Skip the whole suite — for an adapter whose backing store is unavailable
   * (no Postgres on this machine). A skip is never a pass: the caller is
   * expected to say so loudly.
   */
  skip?: boolean;
}

/** Small real delay so successive ISO timestamps are strictly ordered. */
const tick = () => new Promise((r) => setTimeout(r, 5));

export function describeDataStoreConformance(harness: StoreHarness): void {
  describe.skipIf(harness.skip ?? false)(`DataStore conformance — ${harness.name}`, () => {
    let store: DataStore;
    let seq = 0;

    beforeEach(async () => {
      store = await harness.create();
    });

    afterEach(async () => {
      await harness.dispose?.(store);
    });

    /**
     * A registrable customer. Name and email are always supplied: they are
     * required at registration (SCOPE-DECISIONS §2.1) and the production schema
     * enforces it, so a token-only card is not a conformance case.
     */
    const addCustomer = (over: Partial<Parameters<DataStore['createCustomer']>[0]> = {}) => {
      seq += 1;
      return store.createCustomer({
        token: `token-${seq}-${Math.random().toString(36).slice(2, 10)}`,
        displayName: `Customer ${seq}`,
        email: `customer${seq}@cafe.test`,
        ...over,
      });
    };

    const addStaff = (over: Partial<Parameters<DataStore['createStaff']>[0]> = {}) => {
      seq += 1;
      return store.createStaff({
        username: `user${seq}`,
        passwordHash: 'secret',
        role: 'staff',
        ...over,
      });
    };

    /** A counter transaction with the boilerplate filled in. */
    const counter = (over: Partial<CounterTransaction>): CounterTransaction => {
      seq += 1;
      return {
        customerId: 'x',
        pointsDelta: 0,
        redeemRewardIds: [],
        staffId: 'staff-1',
        idempotencyKey: `idem-${seq}-${Math.random().toString(36).slice(2, 10)}`,
        source: 'a',
        ...over,
      };
    };

    /** Pin the threshold so the mechanics are independent of the product default. */
    const pinProgram = () =>
      store.updateConfig({ pointsPerReward: 8, maxPointsPerTransaction: 50 });

    // ── customers ────────────────────────────────────────────────────────────

    describe('customers', () => {
      it('creates a customer and resolves it by id and by token', async () => {
        const created = await addCustomer();
        expect(created.status).toBe('active');
        expect(await store.getCustomerById(created.id)).toMatchObject({ id: created.id });
        expect(await store.getCustomerByToken(created.token)).toMatchObject({ id: created.id });
      });

      it('returns null for an unknown id, token or short code', async () => {
        expect(await store.getCustomerById('nope')).toBeNull();
        expect(await store.getCustomerByToken('nope')).toBeNull();
        expect(await store.getCustomerByShortCode('00000000')).toBeNull();
        expect(await store.getCustomerByShortCode('')).toBeNull();
      });

      it('assigns a unique short code on create and resolves by it', async () => {
        const a = await addCustomer();
        const b = await addCustomer();
        expect(a.shortCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
        expect(a.shortCode).not.toBe(b.shortCode);
        expect(await store.getCustomerByShortCode(a.shortCode)).toMatchObject({ id: a.id });
      });

      it('finds active customers by name, email or phone', async () => {
        await addCustomer({ displayName: 'Maria', email: 'maria@cafe.test' });
        await addCustomer({ phone: '+1 (555) 123-4567' });

        expect(await store.findCustomers({ term: 'mar' })).toHaveLength(1);
        expect(await store.findCustomers({ term: 'MARIA@CAFE.TEST' })).toHaveLength(1);
        expect(await store.findCustomers({ term: '5551234567' })).toHaveLength(1);
        expect(await store.findCustomers({ term: 'nobody-matches-this' })).toHaveLength(0);
        expect(await store.findCustomers({ term: '   ' })).toEqual([]);
      });

      it('never returns a deleted customer from a search', async () => {
        const gone = await addCustomer({ displayName: 'Gone', email: 'gone@cafe.test' });
        await store.softDeleteCustomer(gone.id);
        expect(await store.findCustomers({ term: 'Gone' })).toHaveLength(0);
        expect(await store.findCustomers({ term: 'gone@cafe.test' })).toHaveLength(0);
      });

      it('patches a customer, rotates the token and records consent', async () => {
        const c = await addCustomer();
        const patched = await store.updateCustomer(c.id, { displayName: 'Renamed' });
        expect(patched.displayName).toBe('Renamed');

        const rotated = await store.rotateToken(c.id, `rotated-${c.id}`);
        expect(rotated.token).toBe(`rotated-${c.id}`);
        expect(await store.getCustomerByToken(`rotated-${c.id}`)).toMatchObject({ id: c.id });

        const consented = await store.recordConsent(c.id, '2026-01-01T00:00:00.000Z');
        expect(consented.consentAt).toBe('2026-01-01T00:00:00.000Z');
      });

      it('soft-deletes: status deleted, personal data erased, history kept', async () => {
        const c = await addCustomer({ phone: '555 111 2222' });
        await store.appendTransaction({
          customerId: c.id,
          type: 'accrual',
          points: 2,
          staffId: 's',
        });

        await store.softDeleteCustomer(c.id);

        const after = await store.getCustomerById(c.id);
        expect(after?.status).toBe('deleted');
        expect(after?.displayName).toBeFalsy();
        expect(after?.email).toBeFalsy();
        expect(after?.phone).toBeFalsy();
        // The ledger still points at the id — that is what keeps shop totals right.
        expect(await store.listTransactions(c.id)).toHaveLength(1);
      });

      it('throws when patching a customer that does not exist', async () => {
        await expect(store.updateCustomer('nope', { displayName: 'x' })).rejects.toThrow();
        await expect(store.rotateToken('nope', 'tok')).rejects.toThrow();
        await expect(store.softDeleteCustomer('nope')).rejects.toThrow();
      });
    });

    // ── ledger ───────────────────────────────────────────────────────────────

    describe('loyalty ledger', () => {
      it('appends transactions and lists them oldest-first', async () => {
        const c = await addCustomer();
        await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 1, staffId: 's' });
        await tick();
        await store.appendTransaction({ customerId: c.id, type: 'accrual', points: 2, staffId: 's' });
        expect((await store.listTransactions(c.id)).map((t) => t.points)).toEqual([1, 2]);
      });

      it('derives the balance from the ledger, including reversals', async () => {
        const c = await addCustomer();
        const original = await store.appendTransaction({
          customerId: c.id,
          type: 'accrual',
          points: 3,
          staffId: 's',
        });
        await tick();
        await store.appendTransaction({
          customerId: c.id,
          type: 'reversal',
          points: -3,
          staffId: 's',
          reversesTransactionId: original.id,
          note: 'wrong card',
        });

        const state = await store.getCustomerState(c.id);
        expect(state.balance).toBe(0);
        expect(state.transactions).toHaveLength(2);
        expect(state.transactions[1]?.reversesTransactionId).toBe(original.id);
        expect(state.transactions[1]?.note).toBe('wrong card');
      });

      it('throws reading the state of a customer that does not exist', async () => {
        await expect(store.getCustomerState('nope')).rejects.toThrow();
      });
    });

    // ── the atomic commit ────────────────────────────────────────────────────

    describe('commitCounterTransaction', () => {
      beforeEach(pinProgram);

      it('accrues points and settles the balance below the threshold', async () => {
        const c = await addCustomer();
        const r = await store.commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 3 }));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.minted).toHaveLength(0);
        expect(r.state.balance).toBe(3);
        expect(r.state.progress).toEqual({ current: 3, threshold: 8, rewardsAvailable: 0 });
      });

      it('mints one reward when an accrual crosses the threshold, and settles', async () => {
        const c = await addCustomer();
        const r = await store.commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 8 }));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.minted).toHaveLength(1);
        expect(r.minted[0]?.status).toBe('unspent');
        expect(r.minted[0]?.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(r.minted[0]?.shortCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
        expect(r.minted[0]?.descriptionSnapshot).toBe((await store.getConfig()).rewardDescription);
        expect(r.state.balance).toBe(0);
        expect(r.state.rewards).toHaveLength(1);
        expect(r.state.rewardAvailable).toBe(true);
        // The ledger gained an accrual plus a reward_issue(−threshold).
        const ledger = await store.listTransactions(c.id);
        expect(ledger.map((t) => t.type).sort()).toEqual(['accrual', 'reward_issue']);
        expect(ledger.find((t) => t.type === 'reward_issue')?.points).toBe(-8);
        expect(ledger.find((t) => t.type === 'reward_issue')?.rewardId).toBe(r.minted[0]?.id);
      });

      it('mints several rewards in one commit when a large accrual crosses twice', async () => {
        const c = await addCustomer();
        const r = await store.commitCounterTransaction(
          counter({ customerId: c.id, pointsDelta: 19 }),
        );
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.minted).toHaveLength(2);
        expect(r.state.balance).toBe(3);
        expect(await store.listRewards(c.id, 'unspent')).toHaveLength(2);
      });

      it('is idempotent: a retry with the same key replays the result, writing nothing', async () => {
        const c = await addCustomer();
        const txn = counter({ customerId: c.id, pointsDelta: 3 });
        const first = await store.commitCounterTransaction(txn);
        const second = await store.commitCounterTransaction(txn);
        expect(second).toEqual(first);
        expect(await store.listTransactions(c.id)).toHaveLength(1);
        expect((await store.getCustomerState(c.id)).balance).toBe(3);
      });

      it('redeems a reward, reporting a stale id without aborting (subset redeem)', async () => {
        const c = await addCustomer();
        const minted = await store.commitCounterTransaction(
          counter({ customerId: c.id, pointsDelta: 8 }),
        );
        if (!minted.ok) throw new Error('mint failed');
        const rewardId = minted.minted[0]?.id as string;

        const r = await store.commitCounterTransaction(
          counter({ customerId: c.id, redeemRewardIds: [rewardId, 'ghost-id'] }),
        );
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.redeemed.map((x) => x.id)).toEqual([rewardId]);
        expect(r.redeemed[0]?.spentByStaffId).toBe('staff-1');
        expect(r.rejected).toEqual([{ rewardId: 'ghost-id', reason: 'reward_invalid' }]);
        expect(await store.listRewards(c.id, 'unspent')).toHaveLength(0);
        expect(await store.listRewards(c.id, 'spent')).toHaveLength(1);

        const again = await store.commitCounterTransaction(
          counter({ customerId: c.id, redeemRewardIds: [rewardId] }),
        );
        expect(again.ok && again.rejected).toEqual([{ rewardId, reason: 'already_spent' }]);
      });

      it('redeem-only commits add no ledger entry', async () => {
        const c = await addCustomer();
        const minted = await store.commitCounterTransaction(
          counter({ customerId: c.id, pointsDelta: 8 }),
        );
        if (!minted.ok) throw new Error('mint failed');
        const before = (await store.listTransactions(c.id)).length;

        const r = await store.commitCounterTransaction(
          counter({ customerId: c.id, redeemRewardIds: [minted.minted[0]?.id as string] }),
        );
        expect(r.ok).toBe(true);
        expect(await store.listTransactions(c.id)).toHaveLength(before);
      });

      it("refuses to redeem another customer's reward as not_owner", async () => {
        const a = await addCustomer();
        const b = await addCustomer();
        const minted = await store.commitCounterTransaction(
          counter({ customerId: a.id, pointsDelta: 8 }),
        );
        if (!minted.ok) throw new Error('mint failed');
        const rewardId = minted.minted[0]?.id as string;

        const r = await store.commitCounterTransaction(
          counter({ customerId: b.id, redeemRewardIds: [rewardId] }),
        );
        expect(r.ok && r.rejected).toEqual([{ rewardId, reason: 'not_owner' }]);
        expect(await store.listRewards(a.id, 'unspent')).toHaveLength(1);
      });

      it('rejects an over-cap accrual with no writes', async () => {
        await store.updateConfig({ maxPointsPerTransaction: 3 });
        const c = await addCustomer();
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
    });

    // ── rewards ──────────────────────────────────────────────────────────────

    describe('rewards', () => {
      beforeEach(pinProgram);

      it('lists the rewards a customer owns, filtered by status and oldest-first', async () => {
        const c = await addCustomer();
        const first = await store.commitCounterTransaction(
          counter({ customerId: c.id, pointsDelta: 8 }),
        );
        await tick();
        const second = await store.commitCounterTransaction(
          counter({ customerId: c.id, pointsDelta: 8 }),
        );
        if (!first.ok || !second.ok) throw new Error('mint failed');

        expect(await store.listRewards(c.id)).toHaveLength(2);
        expect((await store.listRewards(c.id)).map((r) => r.id)).toEqual([
          first.minted[0]?.id,
          second.minted[0]?.id,
        ]);

        await store.commitCounterTransaction(
          counter({ customerId: c.id, redeemRewardIds: [first.minted[0]?.id as string] }),
        );
        expect((await store.listRewards(c.id, 'unspent')).map((r) => r.id)).toEqual([
          second.minted[0]?.id,
        ]);
        expect((await store.listRewards(c.id, 'spent')).map((r) => r.id)).toEqual([
          first.minted[0]?.id,
        ]);
      });

      it('returns no rewards for a customer who has none', async () => {
        const c = await addCustomer();
        expect(await store.listRewards(c.id)).toEqual([]);
      });
    });

    // ── staff & config ───────────────────────────────────────────────────────

    describe('staff & config', () => {
      it('creates an account and resolves it by username', async () => {
        const created = await addStaff({ name: 'Bea', role: 'admin' });
        expect(created.active).toBe(true);
        expect(created.role).toBe('admin');
        const found = await store.getStaffByUsername(created.username);
        expect(found).toMatchObject({ id: created.id, name: 'Bea', role: 'admin' });
      });

      it('returns null for an unknown username', async () => {
        expect(await store.getStaffByUsername('nobody-here')).toBeNull();
      });

      it('rejects a duplicate username', async () => {
        const first = await addStaff();
        await expect(
          store.createStaff({ username: first.username, passwordHash: 'pw', role: 'staff' }),
        ).rejects.toThrow();
      });

      it('enables and disables an account, and throws on a missing one', async () => {
        const s = await addStaff();
        await store.setStaffActive(s.id, false);
        expect((await store.getStaffByUsername(s.username))?.active).toBe(false);
        await store.setStaffActive(s.id, true);
        expect((await store.getStaffByUsername(s.username))?.active).toBe(true);

        await expect(store.setStaffActive('nope', false)).rejects.toThrow();
        await expect(store.setStaffPassword('nope', 'pw')).rejects.toThrow();
        await expect(store.setStaffPin('nope', '6666')).rejects.toThrow();
      });

      it('resolves an account by its PIN, and replaces it on reset', async () => {
        const s = await addStaff({ pin: '5678' });
        expect(await store.getStaffByPin('5678')).toMatchObject({ id: s.id });
        expect(await store.getStaffByPin('0000')).toBeNull();
        expect(await store.getStaffByPin('')).toBeNull();

        await store.setStaffPin(s.id, '4444');
        expect(await store.getStaffByPin('5678')).toBeNull();
        expect(await store.getStaffByPin('4444')).toMatchObject({ id: s.id });
      });

      it('never resolves a disabled account by its PIN', async () => {
        const s = await addStaff({ pin: '7777' });
        await store.setStaffActive(s.id, false);
        expect(await store.getStaffByPin('7777')).toBeNull();
      });

      it('deletes an account', async () => {
        const s = await addStaff();
        await store.deleteStaff(s.id);
        expect(await store.getStaffByUsername(s.username)).toBeNull();
      });

      it('lists accounts sorted by username', async () => {
        await addStaff({ username: 'zara' });
        await addStaff({ username: 'bea' });
        const usernames = (await store.listStaff()).map((s) => s.username);
        expect(usernames).toContain('zara');
        expect(usernames).toContain('bea');
        expect([...usernames].sort()).toEqual(usernames);
      });

      it('merges a config patch without dropping the other fields', async () => {
        const before = await store.getConfig();
        const updated = await store.updateConfig({ rewardDescription: 'Free pastry' });
        expect(updated.rewardDescription).toBe('Free pastry');
        expect(updated.pointsPerReward).toBe(before.pointsPerReward);
        expect(await store.getConfig()).toMatchObject({ rewardDescription: 'Free pastry' });
      });

      it('persists the detector thresholds and the revocation epoch', async () => {
        const updated = await store.updateConfig({
          selfDealWindowSec: 45,
          selfDealCount: 4,
          repeatCount: 5,
          repeatWindowMin: 60,
          sessionEpoch: 3,
          dismissedAlerts: ['alert-key'],
        });
        expect(updated).toMatchObject({
          selfDealWindowSec: 45,
          selfDealCount: 4,
          repeatCount: 5,
          repeatWindowMin: 60,
          sessionEpoch: 3,
          dismissedAlerts: ['alert-key'],
        });
        expect(await store.getConfig()).toMatchObject({ selfDealWindowSec: 45, sessionEpoch: 3 });
      });
    });

    // ── recovery codes ───────────────────────────────────────────────────────

    describe('recovery codes', () => {
      it('consumes a code exactly once', async () => {
        const c = await addCustomer();
        await store.createRecoveryCode({
          code: 'code-abc',
          customerId: c.id,
          expiresAt: Date.now() + 60_000,
        });
        expect(await store.consumeRecoveryCode('code-abc')).toBe(c.id);
        expect(await store.consumeRecoveryCode('code-abc')).toBeNull();
      });

      it('refuses an unknown or expired code', async () => {
        const c = await addCustomer();
        await store.createRecoveryCode({
          code: 'code-expired',
          customerId: c.id,
          expiresAt: Date.now() - 1_000,
        });
        expect(await store.consumeRecoveryCode('code-expired')).toBeNull();
        expect(await store.consumeRecoveryCode('never-issued')).toBeNull();
      });
    });

    // ── audit ────────────────────────────────────────────────────────────────

    describe('audit', () => {
      /** Three rows, strictly ordered in time. */
      async function seedAudit(): Promise<void> {
        await store.appendAudit({ actorId: 'a', actorRole: 'admin', action: 'config.update' });
        await tick();
        await store.appendAudit({
          actorId: 'b',
          actorRole: 'staff',
          action: 'loyalty.accrue',
          targetId: 'cust-1',
          details: 'points=2',
        });
        await tick();
        await store.appendAudit({ actorId: 'c', actorRole: 'staff', action: 'loyalty.redeem' });
      }

      it('returns entries newest-first, and filters by action, actor and limit', async () => {
        await seedAudit();
        expect((await store.listAudit()).map((e) => e.action)).toEqual([
          'loyalty.redeem',
          'loyalty.accrue',
          'config.update',
        ]);
        expect(await store.listAudit({ action: 'loyalty.accrue' })).toHaveLength(1);
        expect(await store.listAudit({ actorId: 'b' })).toHaveLength(1);
        expect(await store.listAudit({ limit: 1 })).toHaveLength(1);
      });

      it('keeps the target and details it was given', async () => {
        await seedAudit();
        const [accrual] = await store.listAudit({ action: 'loyalty.accrue' });
        expect(accrual).toMatchObject({
          actorId: 'b',
          actorRole: 'staff',
          targetId: 'cust-1',
          details: 'points=2',
        });
      });

      it('ORs within a field, ANDs across fields, and unions a singular with its plural', async () => {
        await seedAudit();
        const twoActions = await store.listAudit({ actions: ['loyalty.accrue', 'loyalty.redeem'] });
        expect(twoActions.map((e) => e.action).sort()).toEqual([
          'loyalty.accrue',
          'loyalty.redeem',
        ]);
        expect(await store.listAudit({ actorIds: ['b', 'c'] })).toHaveLength(2);
        expect(await store.listAudit({ actions: ['loyalty.accrue'], actorIds: ['c'] })).toHaveLength(0);
        expect(
          await store.listAudit({ action: 'config.update', actions: ['loyalty.accrue'] }),
        ).toHaveLength(2);
      });

      it('bounds a range inclusively at both ends', async () => {
        await seedAudit();
        const all = await store.listAudit();
        const newest = all[0]?.timestamp as string;
        const oldest = all[all.length - 1]?.timestamp as string;
        expect(await store.listAudit({ from: oldest, to: newest })).toHaveLength(3);
        expect(await store.listAudit({ from: newest })).toHaveLength(1);
        expect(await store.listAudit({ to: oldest })).toHaveLength(1);
      });
    });

    // ── stats & backup ───────────────────────────────────────────────────────

    describe('stats & backup', () => {
      it('counts only active customers, and lists every transaction', async () => {
        const a = await addCustomer();
        const b = await addCustomer();
        await store.softDeleteCustomer(b.id);
        await store.appendTransaction({ customerId: a.id, type: 'accrual', points: 2, staffId: 's' });

        expect(await store.countActiveCustomers()).toBe(1);
        expect(await store.listAllTransactions()).toHaveLength(1);
      });

      it('round-trips a snapshot, replacing whatever was there', async () => {
        const kept = await addCustomer({ displayName: 'Maria', email: 'maria@cafe.test' });
        await store.appendTransaction({
          customerId: kept.id,
          type: 'accrual',
          points: 3,
          staffId: 's',
        });
        await store.appendAudit({ actorId: 's', actorRole: 'staff', action: 'card.issue' });
        const snapshot = await store.exportAll();
        expect(snapshot.customers.map((c) => c.id)).toContain(kept.id);

        // Data created after the snapshot must not survive the restore.
        const discarded = await addCustomer({ email: 'discarded@cafe.test' });
        await store.importAll(snapshot);

        expect(await store.getCustomerById(discarded.id)).toBeNull();
        expect(await store.getCustomerByToken(kept.token)).toMatchObject({ displayName: 'Maria' });
        expect(await store.listTransactions(kept.id)).toHaveLength(1);
        expect(await store.listAudit()).toHaveLength(1);
        expect(await store.getConfig()).toEqual(snapshot.config);
      });

      it('imports an empty snapshot as an empty store', async () => {
        await addCustomer();
        const empty: Snapshot = {
          version: 1,
          exportedAt: new Date().toISOString(),
          config: await store.getConfig(),
          staff: [],
          customers: [],
          transactions: [],
          audit: [],
        };
        await store.importAll(empty);

        expect(await store.countActiveCustomers()).toBe(0);
        expect(await store.listStaff()).toEqual([]);
        expect(await store.listAllTransactions()).toEqual([]);
        expect(await store.listAudit()).toEqual([]);
      });
    });
  });
}
