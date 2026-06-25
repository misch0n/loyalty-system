/**
 * Sync-core tests: ObservableStore change emission, SwitchableStore re-pointing,
 * and the full client→host RPC round-trip over a fake link backed by a real
 * IndexedDbStore, including the `changed` push.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { IndexedDbStore } from '../../../src/adapters/storage/IndexedDbStore';
import type { DataStore } from '../../../src/ports/DataStore';
import { createObservableStore } from '../../../src/adapters/sync/ObservableStore';
import { createSwitchableStore } from '../../../src/adapters/sync/SwitchableStore';
import { createPeerClientStore } from '../../../src/adapters/sync/PeerClientStore';
import { createStoreServer } from '../../../src/adapters/sync/StoreServer';
import { makeLinkPair } from './fakeLink';

let host: IndexedDbStore;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  host = new IndexedDbStore();
});

describe('ObservableStore', () => {
  it('fires onMutate after a mutating call (createCustomer)', async () => {
    const observable = createObservableStore(host);
    const spy = vi.fn();
    observable.onMutate(spy);

    await observable.store.createCustomer({ token: 'tok' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onMutate after a read (getConfig / getCustomerById)', async () => {
    const observable = createObservableStore(host);
    const spy = vi.fn();
    observable.onMutate(spy);

    await observable.store.getConfig();
    await observable.store.getCustomerById('nope');
    expect(spy).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further notifications', async () => {
    const observable = createObservableStore(host);
    const spy = vi.fn();
    const off = observable.onMutate(spy);
    off();
    await observable.store.createCustomer({ token: 'tok' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('SwitchableStore', () => {
  it('delegates to the initial target, then to a new one after setTarget', async () => {
    const a = createObservableStore(host).store;

    globalThis.indexedDB = new IDBFactory();
    const otherInner = new IndexedDbStore();
    const b = createObservableStore(otherInner).store;

    const switchable = createSwitchableStore(a);
    expect(switchable.getTarget()).toBe(a);

    const c1 = await switchable.store.createCustomer({ token: 'on-a' });
    // The customer landed in store A, not B.
    expect(await a.getCustomerByToken('on-a')).toMatchObject({ id: c1.id });
    expect(await b.getCustomerByToken('on-a')).toBeNull();

    switchable.setTarget(b);
    expect(switchable.getTarget()).toBe(b);
    const c2 = await switchable.store.createCustomer({ token: 'on-b' });
    expect(await b.getCustomerByToken('on-b')).toMatchObject({ id: c2.id });
    expect(await a.getCustomerByToken('on-b')).toBeNull();
  });
});

describe('PeerClientStore + StoreServer round-trip', () => {
  function wire() {
    const { host: hostLink, client: clientLink } = makeLinkPair();
    const observable = createObservableStore(host);
    const server = createStoreServer(observable, hostLink);
    const client = createPeerClientStore(clientLink);
    return { observable, server, client, hostLink, clientLink };
  }

  it('client createCustomer lands in the host store and is readable via the client', async () => {
    const { client } = wire();
    const created = (await (client.store as DataStore).createCustomer({
      token: 'remote-tok',
      displayName: 'Maria',
    }));
    expect(created.id).toBeTruthy();

    // It really persisted on the host.
    expect(await host.getCustomerByToken('remote-tok')).toMatchObject({ id: created.id });

    // And the client can read it back over the link.
    const viaClient = await client.store.getCustomerByToken('remote-tok');
    expect(viaClient).toMatchObject({ id: created.id });
  });

  it('rejects the client promise when the host method throws', async () => {
    const { client } = wire();
    // rotateToken on a missing id throws in the host store.
    await expect(
      client.store.rotateToken('does-not-exist', 'new-token'),
    ).rejects.toThrow();
  });

  it('a mutation made directly on the host observable store fires the client onChanged', async () => {
    const { observable, client } = wire();
    const changed = vi.fn();
    client.onChanged(changed);

    await observable.store.createCustomer({ token: 'host-local' });

    // Allow the microtask-delivered `changed` envelope to arrive.
    await new Promise((r) => setTimeout(r, 0));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('commitCounterTransaction over RPC lands on the host and a retried key does not double-apply', async () => {
    const { client } = wire();
    const created = await (client.store as DataStore).createCustomer({ token: 'commit-tok' });

    const txn = {
      customerId: created.id,
      pointsDelta: 3,
      redeemRewardIds: [],
      staffId: 'staff-1',
      idempotencyKey: 'idem-1',
      source: 'a' as const,
    };

    const first = await client.store.commitCounterTransaction(txn);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.state.balance).toBe(3);

    // Retry with the SAME key: identical result, no second accrual on the host.
    const retry = await client.store.commitCounterTransaction(txn);
    expect(retry).toEqual(first);

    // The host really has a single settled balance of 3, not 6.
    const state = await host.getCustomerState(created.id);
    expect(state.balance).toBe(3);
    expect((await host.listTransactions(created.id)).filter((t) => t.type === 'accrual')).toHaveLength(1);
  });

  it('dispose rejects pending calls', async () => {
    const { host: hostLink, client: clientLink } = makeLinkPair();
    // No server wired, so the call never gets answered.
    void hostLink;
    const client = createPeerClientStore(clientLink);
    const p = client.store.getConfig();
    client.dispose();
    await expect(p).rejects.toThrow();
  });
});
