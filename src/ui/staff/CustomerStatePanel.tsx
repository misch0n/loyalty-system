/**
 * CustomerStatePanel — the staff view of one customer: derived balance/progress,
 * add-points, redeem, and the ledger with per-entry reversal. Reused by the
 * Scan home and Find-customer screens.
 *
 * Staff initiate every credit here — customers only display their code.
 */

import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import { usePairing } from '../common/PairingContext';
import { ProgressBar } from '../common/Progress';
import { isValidAccrual } from '../../domain/loyalty';
import type { CustomerState } from '../../services/LoyaltyService';

interface Props {
  customerId: string;
  /** Optional extra controls (reissue/correct) rendered by the parent. */
  children?: React.ReactNode;
}

export function CustomerStatePanel({ customerId, children }: Props) {
  const { loyalty } = useServices();
  const { actor } = useSession();
  const { dataVersion } = usePairing();
  const [state, setState] = useState<CustomerState | null>(null);
  const [points, setPoints] = useState(1);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await loyalty.getStateById(customerId);
    setState(next);
    if (next) setPoints(next.config.pointsPerPurchase);
  }, [loyalty, customerId]);

  // Refetch on mount, and whenever paired data changes (e.g. the customer device
  // acts while paired).
  useEffect(() => {
    refresh();
  }, [refresh, dataVersion]);

  if (!state) return <p>Loading customer…</p>;
  if (state.customer.status === 'deleted') {
    return <p className="warn">This card has been deleted.</p>;
  }
  if (!actor) return <p className="warn">Sign in to record loyalty.</p>;

  const { customer, config, transactions, balance, rewardAvailable, progress } = state;
  const reversedIds = new Set(
    transactions.map((t) => t.reversesTransactionId).filter(Boolean) as string[],
  );

  async function addPoints() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await loyalty.accrue(actor!, customer.id, points);
      setFlash(`Added ${Math.min(points, config.maxPointsPerTransaction)} point(s).`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const result = await loyalty.redeem(actor!, customer.id);
      if (result.ok) setFlash(`Redeemed: ${config.rewardDescription}.`);
      else setError(result.reason ?? 'Could not redeem.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reverse(transactionId: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await loyalty.reverse(actor!, customer.id, transactionId, 'Staff correction');
      setFlash('Entry reversed.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reverse the entry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="state-panel">
      <div className="state-head">
        <h2>{customer.displayName ? `Is this ${customer.displayName}?` : 'Anonymous card'}</h2>
        <p className="balance-line">
          <strong>{balance}</strong> point{balance === 1 ? '' : 's'}
        </p>
        <ProgressBar progress={progress} />
        {rewardAvailable && (
          <p className="reward-ready">Reward available: {config.rewardDescription}</p>
        )}
      </div>

      {flash && <p className="flash">{flash}</p>}
      {error && <p className="error">{error}</p>}

      <div className="actions-row">
        <div className="accrue">
          <label>
            Points
            <input
              type="number"
              min={1}
              max={config.maxPointsPerTransaction}
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
            />
          </label>
          <button type="button" onClick={addPoints} disabled={busy || !isValidAccrual(points, config)}>
            Add points
          </button>
          <span className="cap-hint">max {config.maxPointsPerTransaction} per transaction</span>
        </div>

        {rewardAvailable && (
          <button type="button" className="primary" onClick={redeem} disabled={busy}>
            Redeem reward
          </button>
        )}
      </div>

      {children}

      <details className="history">
        <summary>History ({transactions.length})</summary>
        <ul className="ledger">
          {[...transactions].reverse().map((tx) => {
            const reversed = reversedIds.has(tx.id);
            const canReverse = tx.type !== 'reversal' && !reversed;
            return (
              <li key={tx.id} className={`ledger-row ${tx.type}`}>
                <span className="tx-points">
                  {tx.points > 0 ? `+${tx.points}` : tx.points}
                </span>
                <span className="tx-type">{tx.type}</span>
                <time dateTime={tx.timestamp}>{new Date(tx.timestamp).toLocaleString()}</time>
                {reversed && <span className="tag">reversed</span>}
                {canReverse && (
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={() => reverse(tx.id)}
                  >
                    Reverse
                  </button>
                )}
              </li>
            );
          })}
          {transactions.length === 0 && <li className="muted">No entries yet.</li>}
        </ul>
      </details>
    </div>
  );
}
