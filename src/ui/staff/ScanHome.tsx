/**
 * ScanHome — the staff landing screen. Scan (or paste) a customer's card code,
 * resolve them by token, then add points or redeem.
 */

import { useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { QrScanner } from '../common/QrScanner';
import { CustomerStatePanel } from './CustomerStatePanel';

export function ScanHome() {
  const { loyalty } = useServices();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(token: string) {
    setError(null);
    const state = await loyalty.getStateByToken(token);
    if (!state || state.customer.status === 'deleted') {
      setError('No active card for that code. Try again or find the customer by name.');
      setCustomerId(null);
      return;
    }
    setCustomerId(state.customer.id);
  }

  return (
    <div className="screen">
      <h1>Scan a card</h1>
      {!customerId && (
        <>
          <QrScanner onResult={resolve} manualLabel="Customer card code" />
          {error && <p className="error">{error}</p>}
        </>
      )}

      {customerId && (
        <div className="card">
          <button
            type="button"
            className="link"
            onClick={() => {
              setCustomerId(null);
              setError(null);
            }}
          >
            ← Scan another
          </button>
          <CustomerStatePanel customerId={customerId} />
        </div>
      )}
    </div>
  );
}
