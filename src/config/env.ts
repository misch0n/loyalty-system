/**
 * Build mode + feature flags + external-service config.
 *
 * The only place that reads `import.meta.env` for app-level behaviour. Keeping
 * it here means the rest of the code asks plain questions ("which transport?",
 * "is email configured?") instead of poking at env vars in scattered call sites.
 *
 * Secrets (EmailJS public key, TURN credentials) are injected at BUILD time from
 * GitHub Actions secrets — they are intentionally absent from source. A build
 * without them still runs; email and cross-network relay simply degrade.
 */

/** True in `vite build` output, false under `vite`/`vitest`. */
export const isProduction = import.meta.env.PROD;

/** Vite's public base path (e.g. `/loyalty-system/`). Used to build app URLs. */
export const baseUrl: string = import.meta.env.BASE_URL;

/**
 * Which Transport adapter the composition root should wire.
 * - `'peer'` (default, the prototype): real PeerJS + TURN P2P between two devices.
 * - `'server'` (production): server-mediated flow. Select with VITE_TRANSPORT=server.
 *
 * This is a deliberate prototype-vs-production switch (like VITE_DATASTORE), NOT
 * tied to the build mode: the deployed GitHub Pages prototype is a production
 * `vite build` yet must still use the real peer transport. PeerJS is the
 * prototype's REAL transport — there is no in-browser mock.
 */
export type TransportKind = 'peer' | 'server';

export const transportKind: TransportKind =
  import.meta.env.VITE_TRANSPORT === 'server' ? 'server' : 'peer';

/**
 * Which DataStore adapter to wire. The prototype ships only the IndexedDB
 * adapter; `'api'` is reserved for the production HTTP adapter swap.
 */
export type StoreKind = 'indexeddb' | 'api';

export const storeKind: StoreKind =
  import.meta.env.VITE_DATASTORE === 'api' ? 'api' : 'indexeddb';

/**
 * Which WalletProvider adapter to wire.
 * - `'static'` (default, the prototype): map a customer's token to its
 *   pre-generated walletwallet pass URLs; no key in the client.
 * - `'server'` (production): mint-on-demand + push updates server-side. Select
 *   with VITE_WALLET=server.
 */
export type WalletKind = 'static' | 'server';

export const walletKind: WalletKind =
  import.meta.env.VITE_WALLET === 'server' ? 'server' : 'static';

/**
 * Is this the PROTOTYPE build (vs a real production-backend build)?
 *
 * The prototype tools panel (logo tap) must be available on the deployed GitHub
 * Pages demo — which is itself a production `vite build`, so `isProduction` is
 * TRUE there. Gating the panel on `isProduction` therefore wrongly hides it on
 * the very deployment that needs it. The correct signal is the ADAPTER
 * selection: the prototype runs on the local adapters (indexeddb / peer /
 * static wallet); a real production build selects server-backed adapters. When
 * ANY production adapter is wired we treat it as production and drop the
 * prototype-only tools.
 */
export const isPrototype: boolean =
  storeKind !== 'api' && transportKind !== 'server' && walletKind !== 'server';

/**
 * EmailJS configuration for the prototype `Mailer` (client-side send).
 * Injected at build time; empty when not configured (local dev), in which case
 * the composition root falls back to a no-op mailer.
 */
export const emailConfig = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID ?? '',
  templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID ?? '',
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY ?? '',
};

/** True only when all three EmailJS values are present. */
export const isEmailConfigured: boolean = Boolean(
  emailConfig.serviceId && emailConfig.templateId && emailConfig.publicKey,
);

/**
 * Google Place ID for the post-redemption "leave a review" deep link (B4).
 * Defaults to the café's real Place ID; overridable at build time.
 */
export const googlePlaceId: string =
  import.meta.env.VITE_GOOGLE_PLACE_ID || 'ChIJk_kwFsWFqkARDZkg8CtQ2mA';

/**
 * ICE servers for the PeerJS WebRTC transport. STUN is always present (public,
 * not secret). TURN relay entries are added only when credentials were injected
 * at build time — a cross-network demo (customer on cellular, staff on wifi)
 * needs the relay, but the app still loads without it.
 */
const turnHost = import.meta.env.VITE_TURN_HOST ?? 'global.relay.metered.ca';
const turnUsername = import.meta.env.VITE_TURN_USERNAME ?? '';
const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL ?? '';

export const turnConfigured: boolean = Boolean(turnUsername && turnCredential);

export const iceServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: `stun:${turnHost}:80` },
  ...(turnConfigured
    ? [
        { urls: `turn:${turnHost}:80`, username: turnUsername, credential: turnCredential },
        {
          urls: `turn:${turnHost}:80?transport=tcp`,
          username: turnUsername,
          credential: turnCredential,
        },
        { urls: `turn:${turnHost}:443`, username: turnUsername, credential: turnCredential },
        {
          urls: `turns:${turnHost}:443?transport=tcp`,
          username: turnUsername,
          credential: turnCredential,
        },
      ]
    : []),
];
