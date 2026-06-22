/**
 * passStub — prototype "Add to Wallet" stub.
 *
 * Apple: there is NO Apple developer account. The Apple pass is a STATIC .pkpass
 * (just the QR/token) issued by a third-party pass provider — no live updates;
 * the web page is the iPhone user's status surface. Google: a full Google Wallet
 * loyalty pass with dynamic updates/push, issued via Google's REST API. Neither
 * is provisioned in the static prototype, so this simulates the action so the
 * flow is visibly present. See ./README.md for the production integration notes.
 */

export type WalletKind = 'apple' | 'google';

export interface PassStubResult {
  ok: boolean;
  kind: WalletKind;
  /** Human-readable note shown in the prototype UI. */
  message: string;
}

/**
 * Pretend to add the customer's card to a wallet. In production this calls the
 * backend to provision a real pass and register it for push updates.
 */
export async function addToWallet(kind: WalletKind, token: string): Promise<PassStubResult> {
  // No real provisioning in the prototype. The token would identify the pass.
  void token;
  const message =
    kind === 'apple'
      ? 'Demo only: the Apple Wallet pass is a static QR holder (no live updates) — this web page stays your live status on iPhone.'
      : 'Demo only: a live Google Wallet pass with push updates is issued via the Google Wallet API in production.';
  return { ok: true, kind, message };
}
