/**
 * The code mechanics, against a real database.
 *
 * SCOPE-DECISIONS §2.3 is blunt about what protects a six-character code:
 * *"rate limiting and attempt lockout do the work length no longer does."* Every
 * test here is one of those controls, so a regression in any of them fails
 * rather than quietly halving the cost of guessing a card.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Customer } from '@cafe/shared/domain/models';
import type { Db } from '../db';
import { migrate } from '../migrate';
import { PostgresStore } from '../PostgresStore';
import { resetSchema, testPool } from '../testing/database';
import {
  RECOVERY_CODE_LENGTH,
  RECOVERY_MAX_ATTEMPTS,
  consumeRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  isValidRecoveryCode,
  issueRecoveryCode,
  recordFailedAttempt,
} from './codes';

let db: Db;
let store: PostgresStore;
let alice: Customer;
let bob: Customer;

async function liveCodes(customerId: string): Promise<{ attempts: number }[]> {
  const { rows } = await db.query<{ attempts: number }>(
    `SELECT attempts FROM recovery_codes
      WHERE customer_id = $1 AND used_at IS NULL AND expires_at > now()`,
    [customerId],
  );
  return rows;
}

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  alice = await store.createCustomer({
    token: 'alice-token-0000000000',
    displayName: 'Alice',
    email: 'alice@example.test',
  });
  bob = await store.createCustomer({
    token: 'bob-token-00000000000',
    displayName: 'Bob',
    email: 'bob@example.test',
  });
});

afterEach(async () => {
  await db.end();
});

describe('generateRecoveryCode', () => {
  it('is a typeable Crockford code of the documented length', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateRecoveryCode();
      expect(code).toHaveLength(RECOVERY_CODE_LENGTH);
      expect(isValidRecoveryCode(code)).toBe(true);
      // The alphabet is what makes it dictatable across a counter: no I, L, O
      // or U, so nothing is confusable with 1 or 0.
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('does not repeat', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('issueRecoveryCode', () => {
  it('stores only the hash, never the code', async () => {
    const code = await issueRecoveryCode(db, alice.id);
    const { rows } = await db.query<{ code_hash: string }>(
      'SELECT code_hash FROM recovery_codes WHERE customer_id = $1',
      [alice.id],
    );

    expect(rows[0]?.code_hash).toBe(hashRecoveryCode(code));
    expect(rows[0]?.code_hash).not.toContain(code);
  });

  it('supersedes an outstanding code', async () => {
    // Without this, asking ten times leaves ten live codes and a guesser plays
    // against all of them at once.
    const first = await issueRecoveryCode(db, alice.id);
    const second = await issueRecoveryCode(db, alice.id);

    expect(await liveCodes(alice.id)).toHaveLength(1);
    expect(await consumeRecoveryCode(db, alice.id, first)).toBe(false);
    expect(await consumeRecoveryCode(db, alice.id, second)).toBe(true);
  });

  it('leaves another customer’s code alone', async () => {
    const bobs = await issueRecoveryCode(db, bob.id);
    await issueRecoveryCode(db, alice.id);
    expect(await consumeRecoveryCode(db, bob.id, bobs)).toBe(true);
  });
});

describe('consumeRecoveryCode', () => {
  it('accepts the right code once and only once', async () => {
    const code = await issueRecoveryCode(db, alice.id);
    expect(await consumeRecoveryCode(db, alice.id, code)).toBe(true);
    expect(await consumeRecoveryCode(db, alice.id, code)).toBe(false);
  });

  it('refuses a code issued to a different card', async () => {
    // The scoping is the security. A global "consume whatever code this is" —
    // which is what the `DataStore` port offers, for the prototype's 128-bit
    // code — would let a guesser play against every live code in the café at
    // once, and the odds would improve with every customer who asked for one.
    const code = await issueRecoveryCode(db, bob.id);
    expect(await consumeRecoveryCode(db, alice.id, code)).toBe(false);
    // …and Bob's code is still usable: a wrong-address attempt must not burn it.
    expect(await consumeRecoveryCode(db, bob.id, code)).toBe(true);
  });

  it('refuses an expired code', async () => {
    const code = await issueRecoveryCode(db, alice.id);
    await db.query(
      `UPDATE recovery_codes SET expires_at = now() - interval '1 second'
        WHERE customer_id = $1`,
      [alice.id],
    );
    expect(await consumeRecoveryCode(db, alice.id, code)).toBe(false);
  });

  it('refuses a code that has already spent its attempts', async () => {
    // `recordFailedAttempt` burns the code at the limit, so this predicate is
    // the second lock on the same door: it holds when the count reached the
    // limit but the burn has not landed — two wrong guesses racing, or a process
    // killed between the two statements.
    const code = await issueRecoveryCode(db, alice.id);
    await db.query('UPDATE recovery_codes SET attempts = $2 WHERE customer_id = $1', [
      alice.id,
      RECOVERY_MAX_ATTEMPTS,
    ]);

    expect(await consumeRecoveryCode(db, alice.id, code)).toBe(false);
  });

  it('refuses a malformed code without touching the database', async () => {
    await issueRecoveryCode(db, alice.id);
    expect(await consumeRecoveryCode(db, alice.id, '')).toBe(false);
    expect(await consumeRecoveryCode(db, alice.id, 'nope')).toBe(false);
    expect(await liveCodes(alice.id)).toHaveLength(1);
  });

  it('cannot be consumed twice concurrently', async () => {
    // Single-use has to be *enforced*, not checked: the predicate and the write
    // are one statement under one row lock, so two racing requests cannot both
    // come back true.
    const code = await issueRecoveryCode(db, alice.id);
    const results = await Promise.all([
      consumeRecoveryCode(db, alice.id, code),
      consumeRecoveryCode(db, alice.id, code),
      consumeRecoveryCode(db, alice.id, code),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('recordFailedAttempt', () => {
  it('burns the code once the attempt limit is reached', async () => {
    // The durable half of the lockout. An in-memory counter forgets on restart,
    // and "restart the container" must not buy five more guesses.
    const code = await issueRecoveryCode(db, alice.id);
    for (let i = 0; i < RECOVERY_MAX_ATTEMPTS; i += 1) {
      expect(await consumeRecoveryCode(db, alice.id, 'ZZZZZZ')).toBe(false);
      await recordFailedAttempt(db, alice.id);
    }

    expect(await liveCodes(alice.id)).toHaveLength(0);
    // Even the genuine code is dead now — the customer asks for a new one.
    expect(await consumeRecoveryCode(db, alice.id, code)).toBe(false);
  });

  it('leaves the code usable below the limit', async () => {
    const code = await issueRecoveryCode(db, alice.id);
    for (let i = 0; i < RECOVERY_MAX_ATTEMPTS - 1; i += 1) {
      await recordFailedAttempt(db, alice.id);
    }
    expect(await liveCodes(alice.id)).toEqual([{ attempts: RECOVERY_MAX_ATTEMPTS - 1 }]);
    expect(await consumeRecoveryCode(db, alice.id, code)).toBe(true);
  });

  it('does not count against another customer', async () => {
    const bobs = await issueRecoveryCode(db, bob.id);
    await issueRecoveryCode(db, alice.id);
    for (let i = 0; i < RECOVERY_MAX_ATTEMPTS + 2; i += 1) {
      await recordFailedAttempt(db, alice.id);
    }
    expect(await consumeRecoveryCode(db, bob.id, bobs)).toBe(true);
  });
});
