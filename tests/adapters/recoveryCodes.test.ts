/**
 * Recovery-code storage behaviour: create then atomically consume. A code is
 * single-use and short-expiry — the second consume, an expired code, and an
 * unknown code all return null. Codes map to a customerId only; no PII is stored.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDbStore } from '../../src/adapters/storage/IndexedDbStore';

let store: IndexedDbStore;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store = new IndexedDbStore();
});

const future = () => Date.now() + 60_000;

describe('recovery codes', () => {
  it('happy path: create then consume returns the customerId', async () => {
    await store.createRecoveryCode({ code: 'r1', customerId: 'cust-1', expiresAt: future() });
    expect(await store.consumeRecoveryCode('r1')).toBe('cust-1');
  });

  it('is single-use: a second consume returns null', async () => {
    await store.createRecoveryCode({ code: 'r2', customerId: 'cust-2', expiresAt: future() });
    expect(await store.consumeRecoveryCode('r2')).toBe('cust-2');
    expect(await store.consumeRecoveryCode('r2')).toBeNull();
  });

  it('returns null for an expired code (and does not consume it twice)', async () => {
    await store.createRecoveryCode({
      code: 'r3',
      customerId: 'cust-3',
      expiresAt: Date.now() - 1, // already expired
    });
    expect(await store.consumeRecoveryCode('r3')).toBeNull();
  });

  it('returns null for an unknown code', async () => {
    expect(await store.consumeRecoveryCode('does-not-exist')).toBeNull();
  });
});
