/**
 * Build mode + feature flags.
 *
 * The only place that reads `import.meta.env` for app-level behaviour. Keeping
 * it here means the rest of the code asks plain questions ("is the dev peer
 * transport enabled?") instead of poking at env vars in scattered call sites.
 */

/** True in `vite build` output, false under `vite`/`vitest`. */
export const isProduction = import.meta.env.PROD;

/**
 * Which Transport adapter the composition root should wire.
 * - `'bridge'` (default): in-browser LocalBridgeTransport. Zero networking.
 * - `'peer'`: DEV-ONLY PeerJS adapter for true two-device demos.
 *
 * The peer transport is never selected in a production build, regardless of
 * this flag — see the composition root.
 */
export type TransportKind = 'bridge' | 'peer';

export const transportKind: TransportKind =
  import.meta.env.VITE_DEV_TRANSPORT === 'peer' && !isProduction ? 'peer' : 'bridge';

/**
 * Which DataStore adapter to wire. The prototype ships only the IndexedDB
 * adapter; `'api'` is reserved for the production HTTP adapter swap.
 */
export type StoreKind = 'indexeddb' | 'api';

export const storeKind: StoreKind =
  import.meta.env.VITE_DATASTORE === 'api' ? 'api' : 'indexeddb';
