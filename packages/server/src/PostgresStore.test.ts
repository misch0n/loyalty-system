/**
 * `PostgresStore` — the shared conformance suite, plus the behaviour that only a
 * real database can be held to.
 *
 * The conformance half is the point of the phase: the same suite that runs
 * against `IndexedDbStore` in the SPA's test run, run here against Postgres. If
 * both are green the composition-root swap is behaviour-preserving, which is the
 * promise the whole ports architecture is making.
 *
 * The suite below it covers what the prototype *cannot* be held to — the row
 * lock, the tombstone, credentials at rest — so it lives here rather than in the
 * shared file.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDataStoreConformance } from '@cafe/conformance';
import type { CounterTransaction } from '@cafe/shared/ports/DataStore';
import type { Db } from './db';
import { migrate } from './migrate';
import { PostgresStore } from './PostgresStore';
import { resetSchema, testPool } from './testing/database';

let db: Db;

beforeAll(async () => {
  db = testPool();
});

afterAll(async () => {
  if (db) await db.end();
});

/** A genuinely fresh database per test: drop the schema, migrate it back. */
async function freshDatabase(): Promise<void> {
  await resetSchema(db);
  await migrate(db);
}

describeDataStoreConformance({
  name: 'PostgresStore',
  async create() {
    await freshDatabase();
    return new PostgresStore(db);
  },
});

// ── what only a real database can be held to ──────────────────────────────────

describe('PostgresStore — beyond the prototype', () => {
  let store: PostgresStore;
  let seq = 0;

  beforeEach(async () => {
    await freshDatabase();
    store = new PostgresStore(db);
    // Threshold 8 with a wide cap, so one commit can cross it.
    await store.updateConfig({ pointsPerReward: 8, maxPointsPerTransaction: 50 });
  });

  const addCustomer = (over: Record<string, unknown> = {}) => {
    seq += 1;
    return store.createCustomer({
      token: `token-${seq}-${Math.random().toString(36).slice(2, 10)}`,
      displayName: `Customer ${seq}`,
      email: `customer${seq}@cafe.test`,
      ...over,
    });
  };

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

  describe('the row lock (STATUS divergence l)', () => {
    /**
     * Two tills committing "at the same time" from `Promise.all` alone proves
     * nothing: the two connections may happen to serialize by themselves, and
     * the test then passes with no lock at all (it did, before this).
     *
     * So every race below is held open deliberately. A third connection takes
     * the customer row first; both commits then reach the same row and queue
     * behind it; only once both are provably waiting is the row released. The
     * overlap is a fact of the test, not a hope about scheduling.
     */
    async function racedOnCard<A, B>(
      customerId: string,
      launch: () => [Promise<A>, Promise<B>],
    ): Promise<[A, B]> {
      const blocker = await db.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
        const pending = launch();
        // Long enough for both commits to reach the lock and block on it.
        await new Promise((r) => setTimeout(r, 200));
        await blocker.query('COMMIT');
        return await Promise.all(pending);
      } finally {
        blocker.release();
      }
    }

    it('blocks until another connection releases the customer row', async () => {
      const c = await addCustomer();
      const blocker = await db.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [c.id]);

        let settled = false;
        const commit = store
          .commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 5 }))
          .then((r) => {
            settled = true;
            return r;
          });

        await new Promise((r) => setTimeout(r, 250));
        // The assertion the prototype could never make: a commit in progress is
        // held up by a row another connection holds.
        expect(settled).toBe(false);

        await blocker.query('COMMIT');
        expect((await commit).ok).toBe(true);
      } finally {
        blocker.release();
      }
    });

    /**
     * The case IndexedDB cannot win. Two tills scan the same card, five points
     * each, threshold eight. Unlocked, both read a balance of 0, both fold 5
     * against the threshold, and NEITHER mints — the customer loses a free
     * coffee they earned. Locked, the second reads the first's committed
     * balance and mints.
     */
    it('serializes two tills committing against the same card', async () => {
      const c = await addCustomer();

      const [first, second] = await racedOnCard(c.id, () => [
        store.commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 5 })),
        store.commitCounterTransaction(counter({ customerId: c.id, pointsDelta: 5 })),
      ]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      // 5 + 5 = 10 → exactly one reward, balance settles at 2.
      expect(await store.listRewards(c.id, 'unspent')).toHaveLength(1);
      const state = await store.getCustomerState(c.id);
      expect(state.balance).toBe(2);
      expect(state.transactions).toHaveLength(3); // two accruals + one reward_issue
    });

    it('lets only one of two simultaneous redemptions spend a reward', async () => {
      const c = await addCustomer();
      const minted = await store.commitCounterTransaction(
        counter({ customerId: c.id, pointsDelta: 8 }),
      );
      if (!minted.ok) throw new Error('mint failed');
      const rewardId = minted.minted[0]?.id as string;

      const [a, b] = await racedOnCard(c.id, () => [
        store.commitCounterTransaction(counter({ customerId: c.id, redeemRewardIds: [rewardId] })),
        store.commitCounterTransaction(counter({ customerId: c.id, redeemRewardIds: [rewardId] })),
      ]);

      const spends = [a, b].map((r) => (r.ok ? r.redeemed.length : -1));
      expect(spends.filter((n) => n === 1)).toHaveLength(1);
      expect(spends.filter((n) => n === 0)).toHaveLength(1);
      const loser = [a, b].find((r) => r.ok && r.redeemed.length === 0);
      expect(loser?.ok && loser.rejected).toEqual([{ rewardId, reason: 'already_spent' }]);
      expect(await store.listRewards(c.id, 'spent')).toHaveLength(1);
    });

    it('writes once when the same commit is retried concurrently', async () => {
      const c = await addCustomer();
      const txn = counter({ customerId: c.id, pointsDelta: 3 });

      // Both retries pass the idempotency cache read (it is empty), so the
      // second is caught under the lock — or, failing that, by the primary key
      // on insert, which rolls its writes back and replays the winner's result.
      const [a, b] = await racedOnCard(c.id, () => [
        store.commitCounterTransaction(txn),
        store.commitCounterTransaction(txn),
      ]);

      expect(a).toEqual(b);
      expect(await store.listTransactions(c.id)).toHaveLength(1);
      expect((await store.getCustomerState(c.id)).balance).toBe(3);
    });
  });

  describe('the tombstone (SCOPE-DECISIONS §3.3)', () => {
    it('erases the token and short code, so the dead card can never be scanned', async () => {
      const c = await addCustomer();
      await store.softDeleteCustomer(c.id);

      expect(await store.getCustomerByToken(c.token)).toBeNull();
      expect(await store.getCustomerByShortCode(c.shortCode)).toBeNull();
      // The row itself survives, carrying nothing that resolves to a person.
      const tombstone = await store.getCustomerById(c.id);
      expect(tombstone).toMatchObject({ id: c.id, status: 'deleted' });
      expect(tombstone?.createdAt).toBe(c.createdAt);
    });

    it('frees the email address for a fresh card starting at zero', async () => {
      const first = await addCustomer({ email: 'returning@cafe.test' });
      await store.commitCounterTransaction(counter({ customerId: first.id, pointsDelta: 5 }));
      await store.softDeleteCustomer(first.id);

      const second = await addCustomer({ email: 'returning@cafe.test' });
      expect((await store.getCustomerState(second.id)).balance).toBe(0);
      // The old card's history is intact, still pointing at the tombstone.
      expect(await store.listTransactions(first.id)).toHaveLength(1);
    });

    it('refuses to commit against a tombstone — it keeps its history and gains none', async () => {
      const c = await addCustomer();
      await store.softDeleteCustomer(c.id);

      const r = await store.commitCounterTransaction(
        counter({ customerId: c.id, pointsDelta: 1 }),
      );
      expect(r).toEqual({ ok: false, error: 'customer_not_found' });
      expect(await store.listTransactions(c.id)).toHaveLength(0);
    });
  });

  describe('credentials at rest (BACKEND-PLAN §4-A)', () => {
    it('hashes a password and a PIN with argon2id, never storing what it was given', async () => {
      const created = await store.createStaff({
        username: 'cashier',
        passwordHash: 'hunter2',
        role: 'staff',
        pin: '4321',
      });

      const { rows } = await db.query<{ password_hash: string; pin_hash: string | null }>(
        'SELECT password_hash, pin_hash FROM staff_accounts WHERE id = $1',
        [created.id],
      );
      expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0]?.password_hash).not.toBe('hunter2');
      expect(rows[0]?.pin_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0]?.pin_hash).not.toBe('4321');
      // …and the behaviour built on them still holds.
      expect(await store.getStaffByPin('4321')).toMatchObject({ id: created.id });
    });

    it('re-hashes on reset rather than storing the new value verbatim', async () => {
      const created = await store.createStaff({
        username: 'cashier',
        passwordHash: 'old',
        role: 'staff',
      });
      await store.setStaffPassword(created.id, 'new-password');

      const { rows } = await db.query<{ password_hash: string }>(
        'SELECT password_hash FROM staff_accounts WHERE id = $1',
        [created.id],
      );
      expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0]?.password_hash).not.toBe('new-password');
    });

    it('stores recovery codes hashed', async () => {
      const c = await addCustomer();
      await store.createRecoveryCode({
        code: 'plaintext-code',
        customerId: c.id,
        expiresAt: Date.now() + 60_000,
      });

      const { rows } = await db.query<{ code_hash: string }>('SELECT code_hash FROM recovery_codes');
      expect(rows[0]?.code_hash).not.toBe('plaintext-code');
      expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await store.consumeRecoveryCode('plaintext-code')).toBe(c.id);
    });
  });

  describe('the retired redeem path', () => {
    /**
     * `redeemReward` wrote a `'redemption'` ledger entry; migration 001 narrows
     * the type vocabulary so the database refuses one. Refusing loudly beats
     * returning `ok: false`, which staff would read as "not enough points".
     */
    it('refuses redeemReward rather than writing a retired ledger type', async () => {
      const c = await addCustomer();
      await expect(store.redeemReward(c.id, 'staff-1')).rejects.toThrow(/retired/);
      expect(await store.listTransactions(c.id)).toHaveLength(0);
    });

    it('refuses a directly appended redemption entry', async () => {
      const c = await addCustomer();
      await expect(
        store.appendTransaction({
          customerId: c.id,
          type: 'redemption',
          points: -8,
          staffId: 'staff-1',
        }),
      ).rejects.toThrow();
    });
  });

  describe('integrity the browser could not enforce', () => {
    it('refuses a second active card on the same email address', async () => {
      await addCustomer({ email: 'taken@cafe.test' });
      await expect(addCustomer({ email: 'TAKEN@cafe.test' })).rejects.toThrow();
    });

    it('refuses a duplicate token', async () => {
      const first = await addCustomer();
      await expect(addCustomer({ token: first.token })).rejects.toThrow();
    });

    it('keeps ledger attribution after the staff account is deleted', async () => {
      const staff = await store.createStaff({
        username: 'leaver',
        passwordHash: 'pw',
        role: 'staff',
      });
      const c = await addCustomer();
      await store.commitCounterTransaction(
        counter({ customerId: c.id, pointsDelta: 2, staffId: staff.id }),
      );

      await store.deleteStaff(staff.id);

      const ledger = await store.listTransactions(c.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.staffId).toBe(staff.id);
    });
  });
});
