/**
 * ScanHome — the staff landing screen. Scan (or paste) a customer's card code,
 * resolve them by token, then add points or redeem.
 */

import { useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import { QrScanner } from '../common/QrScanner';
import { tokenFromCardScan } from '../../qr/encode';
import { CustomerStatePanel } from './CustomerStatePanel';

export function ScanHome() {
  const { loyalty, customers } = useServices();
  const { actor } = useSession();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState(false);

  async function resolve(rawScan: string) {
    setError(null);
    setProvisioned(false);
    // The card QR encodes the card-page URL (B2); accept a bare token too.
    const token = tokenFromCardScan(rawScan);

    const state = await loyalty.getStateByToken(token);
    if (state && state.customer.status !== 'deleted') {
      setCustomerId(state.customer.id);
      return;
    }
    if (state && state.customer.status === 'deleted') {
      setError('That card was deleted and cannot take points.');
      setCustomerId(null);
      return;
    }

    // Unknown token: a card created on another device (e.g. self-registered).
    // Auto-provision it here so staff can credit it; staff still adds the point.
    if (!actor) return;
    try {
      const customer = await customers.provisionFromToken(actor, token);
      setProvisioned(true);
      setCustomerId(customer.id);
    } catch {
      setError('That code isn’t a valid card. Try again or find the customer by name.');
      setCustomerId(null);
    }
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
              setProvisioned(false);
            }}
          >
            ← Scan another
          </button>
          {provisioned && (
            <p className="hint">New card — first time seen on this device. Add their point as usual.</p>
          )}
          <CustomerStatePanel customerId={customerId} />
        </div>
      )}
    </div>
  );
}
