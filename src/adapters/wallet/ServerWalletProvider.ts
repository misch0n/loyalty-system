/**
 * ServerWalletProvider — production seam placeholder.
 *
 * In production the wallet pass is minted on demand and updated on accrual with
 * the signing key held server-side (Apple PassKit + APNs, Google Wallet REST).
 * That backend is out of scope for the prototype, so every method throws —
 * exactly like ApiStore / ServerTransport. This exists only so the composition
 * root can name a production wallet provider behind VITE_WALLET=server without
 * pulling any prototype wallet wiring into a production build.
 */

import type {
  WalletDerivedState,
  WalletPass,
  WalletProvider,
} from '../../ports/WalletProvider';

const NOT_IMPLEMENTED =
  'ServerWalletProvider is a production placeholder — wire mint-on-demand + APNs/Google REST server-side.';

export class ServerWalletProvider implements WalletProvider {
  // `async` so callers get a rejected Promise (not a synchronous throw),
  // matching the future server adapter's behaviour and the ApiStore pattern.
  async ensurePass(_customerId: string): Promise<WalletPass> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async pushUpdate(_customerId: string, _derivedState: WalletDerivedState): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
