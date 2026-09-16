/**
 * Build mode + external-service config.
 *
 * The only place that reads `import.meta.env` for app-level behaviour.
 *
 * ## What Phase 6 removed, and why there is so little left
 *
 * This file used to pick adapters: `VITE_DATASTORE` chose IndexedDB or the API,
 * `VITE_TRANSPORT` chose PeerJS or a server, `VITE_WALLET` chose a static pass
 * map or a mint-on-demand one, and `isPrototype` was the conjunction of all
 * three — the signal the developer panel was gated on, because the deployed
 * GitHub Pages demo was a production `vite build` that still had to show it.
 *
 * There is nothing left to choose. The triage deleted the wallet and transport
 * seams outright (SCOPE-DECISIONS §1), and the 2026-09-16 decision retired the
 * IndexedDB prototype, so there is one store, one mail sender (the server) and
 * one identity mechanism. An adapter flag whose every value is the same value is
 * a thing to maintain and a thing to be wrong about.
 *
 * Gone with them: the EmailJS credentials (the server sends the mail now, with
 * the provider credential where it belongs) and the STUN/TURN ICE servers (there
 * is no peer connection left to relay).
 */

/** True in `vite build` output, false under `vite`/`vitest`. */
export const isProduction = import.meta.env.PROD;

/** Vite's public base path. Used to build app URLs (`config/links.ts`). */
export const baseUrl: string = import.meta.env.BASE_URL;

/** Base path the SPA reaches the API on. Same origin in the Compose bundle. */
export const apiBaseUrl: string = import.meta.env.VITE_API_BASE ?? '/api';

/**
 * Google Place ID for the post-redemption "leave a review" deep link (B4).
 * Defaults to the café's real Place ID; overridable at build time.
 */
export const googlePlaceId: string =
  import.meta.env.VITE_GOOGLE_PLACE_ID || 'ChIJk_kwFsWFqkARDZkg8CtQ2mA';
