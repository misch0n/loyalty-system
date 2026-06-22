/**
 * SwitchableStore — a DataStore facade that delegates to a CURRENT target read at
 * call time, so swapping the target re-points all future calls.
 *
 * PROTOTYPE sync glue. The app boots talking to its local store; when the device
 * pairs as a client, the composition root swaps the target to a PeerClientStore
 * (RPC to the host) without re-wiring any services or UI. Swapping back restores
 * local operation.
 *
 * Proxy over STORE_METHOD_SET so only DataStore methods are forwarded.
 */

import type { DataStore } from '../../ports/DataStore';
import { STORE_METHOD_SET } from './storeMethods';

export function createSwitchableStore(initial: DataStore): {
  store: DataStore;
  setTarget(t: DataStore): void;
  getTarget(): DataStore;
} {
  let target = initial;

  // The proxy target is a throwaway object; all known method access is routed to
  // the current `target` instead. Other property access falls through to it.
  const store = new Proxy({} as DataStore, {
    get(_carrier, prop, receiver) {
      if (typeof prop === 'string' && STORE_METHOD_SET.has(prop)) {
        return (...args: unknown[]): unknown => {
          const fn = Reflect.get(target, prop, target) as (
            ...a: unknown[]
          ) => unknown;
          return fn.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as DataStore;

  return {
    store,
    setTarget(t: DataStore): void {
      target = t;
    },
    getTarget(): DataStore {
      return target;
    },
  };
}
