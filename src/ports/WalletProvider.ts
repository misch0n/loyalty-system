/**
 * `WalletProvider` — the wallet-pass seam (UX §1, §4.3, §7).
 *
 * Issues and updates a customer's wallet pass. Async from day one so the
 * prototype's static-map adapter and the production mint-on-demand adapter share
 * one call site (mirrors the DataStore/Transport pattern).
 *
 *  - proto: `StaticWalletProvider` maps a customer's opaque token to its
 *    pre-generated walletwallet pass URLs; `pushUpdate` is a no-op (Free tier =
 *    static snapshot, the web card is the source of truth).
 *  - prod:  `ServerWalletProvider` mints on demand and pushes via APNs / Google
 *    REST with the key held server-side (placeholder; throws here).
 */

/** A customer's resolved wallet pass: serial + per-wallet download URLs. */
export interface WalletPass {
  serial: string;
  appleUrl: string;
  googleUrl: string;
}

/**
 * Derived progress reflected onto an installed pass (Pro tier only).
 *
 * Rewards-as-objects: `rewardCount` is the number of unspent reward objects the
 * customer currently holds (the "N free coffees" the card shows), replacing the
 * old `rewardAvailable` boolean. `balance` is the settled stamp count
 * (0..threshold−1) after any mint-on-cross.
 */
export interface WalletDerivedState {
  balance: number;
  rewardCount: number;
}

export interface WalletProvider {
  /** Return the customer's existing pass, creating one if needed. */
  ensurePass(customerId: string): Promise<WalletPass>;
  /** Reflect new derived progress onto the installed pass (no-op on Free). */
  pushUpdate(customerId: string, derivedState: WalletDerivedState): Promise<void>;
}
