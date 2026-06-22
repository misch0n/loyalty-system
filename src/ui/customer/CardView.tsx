/**
 * CardView — the issued card: token QR + add-to-wallet (stubbed) + status link.
 * Shown to the customer after registration finalizes, and on reissue.
 */

import { useState } from 'react';
import { QrDisplay } from '../common/QrDisplay';
import { cardPayload } from '../../qr/encode';
import { appUrl } from '../../config/links';
import { addToWallet, type WalletKind } from '../../wallet/passStub';
import type { Customer } from '../../domain/models';

export function CardView({ customer }: { customer: Customer }) {
  const [walletNote, setWalletNote] = useState<string | null>(null);

  async function onAddToWallet(kind: WalletKind) {
    const result = await addToWallet(kind, customer.token);
    setWalletNote(result.message);
  }

  const statusUrl = appUrl(`/status/${customer.token}`);

  return (
    <div className="card-view">
      <h3>{customer.displayName ? `${customer.displayName}'s card` : 'Loyalty card'}</h3>
      <QrDisplay payload={cardPayload(customer.token)} label="Loyalty card QR" caption="Show this at the till" />

      <div className="wallet-stubs">
        <button type="button" onClick={() => onAddToWallet('apple')}>
           Add to Apple Wallet
        </button>
        <button type="button" onClick={() => onAddToWallet('google')}>
          Add to Google Wallet
        </button>
      </div>
      {walletNote && <p className="hint">{walletNote}</p>}

      <p className="hint">
        Check your points any time:&nbsp;
        <a href={`#/status/${customer.token}`}>open status page</a>.
      </p>
      <p className="muted small">Status link: <code>{statusUrl}</code></p>
    </div>
  );
}
