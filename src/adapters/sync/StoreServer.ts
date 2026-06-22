/**
 * StoreServer — the HOST side of the prototype sync seam.
 *
 * PROTOTYPE sync glue. Runs on the staff device. It (a) services `rpc-req`
 * envelopes from the paired client by calling the matching DataStore method on
 * the host's observable store and replying `rpc-res`, and (b) pushes `changed`
 * to the client after any mutation on the host (local or remote), driven by the
 * ObservableStore's onMutate.
 *
 * Atomic/append-only semantics are the inner store's job; this only dispatches.
 * No PII in error strings — replies carry only the thrown error's message, never
 * the call args.
 */

import type { DataStore } from '../../ports/DataStore';
import type { PeerLink, SyncMessage } from './PeerLink';
import { STORE_METHOD_SET } from './storeMethods';

export interface Observable {
  store: DataStore;
  onMutate(cb: () => void): () => void;
}

export function createStoreServer(
  observable: Observable,
  link: PeerLink,
): { dispose(): void } {
  const unsubscribeMessages = link.onMessage((raw) => {
    const msg = raw as SyncMessage;
    if (!msg || typeof msg !== 'object' || msg.t !== 'rpc-req') return;
    void handleRequest(msg);
  });

  async function handleRequest(msg: Extract<SyncMessage, { t: 'rpc-req' }>): Promise<void> {
    const { id, method, args } = msg;
    // Ignore unknown methods entirely — no reply, matching "ignore unknown".
    if (!STORE_METHOD_SET.has(method)) return;
    try {
      // `method` is a verified DataStore key; cast to invoke it generically.
      const fn = (observable.store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
      const result = await fn.apply(observable.store, args);
      const res: SyncMessage = { t: 'rpc-res', id, ok: true, result };
      link.send(res);
    } catch (err) {
      // Only the error message crosses the wire — never args/PII.
      const error = err instanceof Error ? err.message : 'Request failed.';
      const res: SyncMessage = { t: 'rpc-res', id, ok: false, error };
      link.send(res);
    }
  }

  const unsubscribeMutate = observable.onMutate(() => {
    const msg: SyncMessage = { t: 'changed' };
    link.send(msg);
  });

  return {
    dispose(): void {
      unsubscribeMessages();
      unsubscribeMutate();
    },
  };
}
