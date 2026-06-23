/**
 * StaticWalletProvider — the prototype `WalletProvider` (UX §4.3 proto path).
 *
 * The walletwallet passes are PRE-GENERATED with baked-in barcodes, so there is
 * no minting and no key in the client. `ensurePass` resolves the customer's
 * opaque token (via the DataStore) and maps it to its pre-generated pass URLs.
 * `pushUpdate` is a deliberate no-op: on the walletwallet Free tier the pass is a
 * STATIC snapshot and the web card remains the source of truth — live updates
 * require Pro, which is the production `ServerWalletProvider`'s job.
 */

import type { DataStore } from '../../ports/DataStore';
import type {
  WalletDerivedState,
  WalletPass,
  WalletProvider,
} from '../../ports/WalletProvider';
import { passSerialForToken, walletPassUrl } from '../../wallet/passes';

export class StaticWalletProvider implements WalletProvider {
  constructor(private readonly store: DataStore) {}

  async ensurePass(customerId: string): Promise<WalletPass> {
    const customer = await this.store.getCustomerById(customerId);
    if (!customer) {
      throw new Error('No card found to add to a wallet.');
    }
    const { token } = customer;
    return {
      serial: passSerialForToken(token),
      appleUrl: walletPassUrl('apple', token),
      googleUrl: walletPassUrl('google', token),
    };
  }

  async pushUpdate(_customerId: string, _derivedState: WalletDerivedState): Promise<void> {
    // No-op on the Free tier: the pre-generated pass is a static snapshot. The
    // web card is the source of truth; the UI must not imply auto-updates.
  }
}
