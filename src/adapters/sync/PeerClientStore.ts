/**
 * PeerClientStore — a DataStore that proxies every call to the paired HOST over a
 * PeerLink via RPC.
 *
 * PROTOTYPE sync glue. The customer device, once paired as a client, has no local
 * authority over the shared data: every DataStore method becomes an `rpc-req` to
 * the host, which runs it against its real store and replies `rpc-res`. Inbound
 * `changed` envelopes tell the client to refetch.
 *
 * Append-only / atomic semantics live in the host's inner store — this is a thin
 * remote proxy. No PII is logged: timeout/error strings carry only the error
 * message the host produced, never method args.
 */

import type { DataStore } from '../../ports/DataStore';
import type { PeerLink, SyncMessage } from './PeerLink';
import { STORE_METHOD_SET } from './storeMethods';

/** Per-call timeout for a host reply. */
const RPC_TIMEOUT_MS = 10_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createPeerClientStore(link: PeerLink): {
  store: DataStore;
  onChanged(cb: () => void): () => void;
  dispose(): void;
} {
  const pending = new Map<string, Pending>();
  const changedListeners = new Set<() => void>();
  let seq = 0;

  const settle = (id: string): Pending | undefined => {
    const p = pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(id);
    }
    return p;
  };

  const unsubscribe = link.onMessage((raw) => {
    const msg = raw as SyncMessage;
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'rpc-res') {
      const p = settle(msg.id);
      if (!p) return;
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    } else if (msg.t === 'changed') {
      for (const cb of [...changedListeners]) cb();
    }
  });

  const call = (method: string, args: unknown[]): Promise<unknown> => {
    const id = `c${++seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settle(id)) {
          reject(new Error('The paired device did not respond. Check the connection and try again.'));
        }
      }, RPC_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      const req: SyncMessage = { t: 'rpc-req', id, method, args };
      link.send(req);
    });
  };

  const store = new Proxy({} as DataStore, {
    get(_carrier, prop) {
      if (typeof prop === 'string' && STORE_METHOD_SET.has(prop)) {
        return (...args: unknown[]): Promise<unknown> => call(prop, args);
      }
      return undefined;
    },
  }) as DataStore;

  return {
    store,
    onChanged(cb: () => void): () => void {
      changedListeners.add(cb);
      return () => {
        changedListeners.delete(cb);
      };
    },
    dispose(): void {
      unsubscribe();
      changedListeners.clear();
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('The connection to the paired device was closed.'));
      }
      pending.clear();
    },
  };
}
