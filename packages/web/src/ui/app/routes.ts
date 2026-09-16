/**
 * Route path constants + builders for the rebuilt Ckyka Rewards frontend
 * (UX-SPEC §2, UI-SPEC §4). Screen agents and the final App wiring import these
 * so the strings stay in one place and agree. Patterns use react-router param
 * syntax (`:token`, `:code`); the builders produce concrete paths.
 */

export const ROUTES = {
  /** Unrecognized visitor landing (UI-SPEC §4.1). */
  welcome: '/welcome',
  /** Self-registration (§4.2). */
  register: '/register',
  /** Lost-card recovery entry (§4.3). */
  lost: '/lost',
  /** Recovery landing; `:code` is the magic-link param (§5). */
  recover: '/recover',
  recoverWithCode: '/recover/:code',
  /** Customer card hub; `:token` is the opaque card token (§4.4). */
  card: '/card/:token',
  /** Self-resolving card: redirects to `/card/:token` from IdentityStore. */
  cardSelf: '/card',
  /** Staff/admin PIN sign-in, reached via logo long-press (§4.7, §6). */
  login: '/login',
  /** PIN re-auth for a locked trusted device (§6). */
  staffUnlock: '/staff/unlock',
  /** Staff idle landing (§4.8). */
  staff: '/staff',
  /** Staff scan workflow (§4.9). */
  staffScan: '/staff/scan',
  /** Admin root; subroutes live under `/admin/...` (§4.10). */
  admin: '/admin',
  /** Prototype device-pairing screen (kept for the prototype build). */
  pair: '/pair',
} as const;

export type RouteKey = keyof typeof ROUTES;

/**
 * Scan-payload URL shapes (rewards-as-objects, REWARDS-PLAN §3.5). These are the
 * paths baked into the **card / reward QR** and parsed by `qr/encode.ts`
 * `parseScan` — they are **staff-scan URLs only and are deliberately NOT mounted
 * as react-router routes** (a customer is never navigated to them). Built by
 * `cardScanPayload` / `rewardScanPayload`; documented here so the formats live
 * beside the app's other routes.
 */
export const SCAN_PAYLOADS = {
  /** Card QR: `…/#/c/<customerToken>?s=a|w`. */
  card: '/c/:token',
  /** Reward QR: `…/#/r?ids=<rewardToken[,rewardToken…]>&c=<customerToken>&s=a`. */
  reward: '/r',
} as const;

/** Concrete card path for a token (§4.4). */
export function cardPath(token: string): string {
  return `/card/${encodeURIComponent(token)}`;
}

/** Concrete recovery path for a magic-link code (§5). */
export function recoverPath(code: string): string {
  return `/recover/${encodeURIComponent(code)}`;
}

/** Concrete admin subroute path, e.g. `adminPath('staff')` → `/admin/staff`. */
export function adminPath(section?: string): string {
  return section ? `/admin/${section}` : ROUTES.admin;
}
