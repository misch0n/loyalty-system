/**
 * passStub — prototype "Add to Wallet" stub.
 *
 * Apple Wallet pass updates require the Node backend (PassKit web service +
 * APNs); Google Wallet uses Google's REST API. Neither can run in a static-only
 * prototype, so this simulates the action so the flow is visibly present. See
 * ./README.md for the production integration notes.
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
  const label = kind === 'apple' ? 'Apple Wallet' : 'Google Wallet';
  return {
    ok: true,
    kind,
    message: `Demo only: a real ${label} pass with push updates needs the production backend.`,
  };
}
