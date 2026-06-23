/**
 * WalletButton — "Add to Apple/Google Wallet" for the customer's own card.
 *
 * Detects the device OS and offers the matching wallet, linking to the
 * pre-generated walletwallet pass for this card (see wallet/passes.ts). It's a
 * plain link so the OS can intercept the pass download/save reliably.
 */

import { detectWalletKind, walletPassUrl } from '../../wallet/passes';

export function WalletButton({ token }: { token: string }) {
  const kind = detectWalletKind();
  const url = walletPassUrl(kind, token);
  return (
    <a className="button primary wallet-btn" href={url} target="_blank" rel="noopener noreferrer">
      {kind === 'apple' ? ' Add to Apple Wallet' : 'Add to Google Wallet'}
    </a>
  );
}
