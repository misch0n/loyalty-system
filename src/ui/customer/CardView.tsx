/**
 * CardView — the issued card: token QR + add-to-wallet (stubbed) + status link.
 * Shown to the customer after registration finalizes, and on reissue.
 */

import { QrDisplay } from '../common/QrDisplay';
import { cardPayload } from '../../qr/encode';
import { appUrl } from '../../config/links';
import { WalletButton } from './WalletButton';
import { RememberControl } from './RememberControl';
import type { Customer } from '../../domain/models';

export function CardView({ customer }: { customer: Customer }) {
  const statusUrl = appUrl(`/status/${customer.token}`);

  return (
    <div className="card-view">
      <h3>{customer.displayName ? `${customer.displayName}'s card` : 'Loyalty card'}</h3>
      <QrDisplay payload={cardPayload(customer.token)} label="Loyalty card QR" caption="Show this at the till" />

      <div className="wallet-stubs">
        <WalletButton token={customer.token} />
      </div>

      <RememberControl
        token={customer.token}
        recoverable={Boolean(customer.email || customer.displayName)}
      />

      <p className="hint">
        Check your points any time:&nbsp;
        <a href={`#/status/${customer.token}`}>open status page</a>.
      </p>
      <p className="muted small">Status link: <code>{statusUrl}</code></p>
    </div>
  );
}
