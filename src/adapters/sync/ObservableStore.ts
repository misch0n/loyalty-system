/**
 * ObservableStore — wraps a DataStore and emits a change notification after any
 * mutating method resolves successfully.
 *
 * PROTOTYPE sync glue. The host (staff device) wraps its real store in this so
 * the StoreServer can push a `changed` envelope to the paired client whenever the
 * host's data changes — including mutations made locally on the host, not just
 * those that arrived over RPC.
 *
 * Implemented with a Proxy keyed off STORE_METHODS so we don't hand-write the
 * full DataStore surface; only names in STORE_METHOD_SET are intercepted, and
 * only MUTATING_METHODS trigger listeners.
 */

import type { DataStore } from '../../ports/DataStore';
import { STORE_METHOD_SET, MUTATING_METHODS } from './storeMethods';

export function createObservableStore(inner: DataStore): {
  store: DataStore;
  onMutate(cb: () => void): () => void;
} {
  const listeners = new Set<() => void>();

  const emit = (): void => {
    // Snapshot so a listener unsubscribing during emit is safe.
    for (const cb of [...listeners]) cb();
  };

  const store = new Proxy(inner, {
    get(target, prop, receiver) {
      // Only intercept known DataStore methods; everything else passes through.
      if (typeof prop === 'string' && STORE_METHOD_SET.has(prop)) {
        // `prop` is a DataStore method key; the cast keeps the indexed access
        // typed without leaking `any` past this boundary.
        const original = Reflect.get(target, prop, receiver) as (
          ...args: unknown[]
        ) => Promise<unknown>;
        const mutating = MUTATING_METHODS.has(prop as never);
        return (...args: unknown[]): Promise<unknown> => {
          const result = original.apply(target, args);
          if (mutating) {
            return result.then((value) => {
              emit();
              return value;
            });
          }
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as DataStore;

  return {
    store,
    onMutate(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
