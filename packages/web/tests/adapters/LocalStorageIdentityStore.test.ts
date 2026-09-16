/**
 * Tests for the prototype IdentityStore adapter. jsdom provides a working
 * localStorage. Verifies the set→get roundtrip, the unrecognized-browser case,
 * and that clear forgets the token.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageIdentityStore } from '../../src/adapters/identity/LocalStorageIdentityStore';

let store: LocalStorageIdentityStore;

beforeEach(() => {
  window.localStorage.clear();
  store = new LocalStorageIdentityStore();
});

describe('LocalStorageIdentityStore', () => {
  it('returns the token after a set→get roundtrip', async () => {
    await store.set('opaque-token-123');
    expect(await store.get()).toBe('opaque-token-123');
  });

  it('returns null when nothing is stored', async () => {
    expect(await store.get()).toBeNull();
  });

  it('forgets the token on clear', async () => {
    await store.set('opaque-token-123');
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
