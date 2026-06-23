/**
 * Status — the customer web check-up. Look up loyalty state by token (the QR
 * payload), with no account or password. Also the entry point to delete data.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { usePairing } from '../common/PairingContext';
import { ProgressBar } from '../common/Progress';
import { QrDisplay } from '../common/QrDisplay';
import { WalletButton } from './WalletButton';
import { RememberControl } from './RememberControl';
import { ReviewPrompt } from './ReviewPrompt';
import { cardPayload } from '../../qr/encode';
import type { CustomerState } from '../../services/LoyaltyService';

export function Status() {
  const { token: tokenParam } = useParams<{ token: string }>();
  const { loyalty } = useServices();
  const { dataVersion } = usePairing();
  const navigate = useNavigate();

  const [token, setToken] = useState(tokenParam ?? '');
  const [state, setState] = useState<CustomerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The token currently displayed, so we can refetch it live when paired data changes.
  const activeToken = useRef<string | null>(tokenParam ?? null);

  async function lookup(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setState(null);
    try {
      const result = await loyalty.getStateByToken(trimmed);
      if (!result || result.customer.status === 'deleted') {
        setError('No active card found for that code.');
        return;
      }
      setState(result);
      activeToken.current = trimmed;
      // B1: viewing a card no longer auto-remembers it — the RememberControl
      // below lets the customer decide, protecting an already-saved card.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tokenParam) lookup(tokenParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam]);

  // Live refresh: when paired (server stand-in) data changes, refetch the card
  // currently shown — this is how the customer sees points the moment staff add them.
  useEffect(() => {
    if (dataVersion > 0 && activeToken.current) lookup(activeToken.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // We can always show the customer's own QR from the token in the URL, even
  // before the paired host has provisioned the card — that's what staff scans.
  const cardToken = tokenParam ?? state?.customer.token ?? null;

  return (
    <div className="card">
      <h1>Your loyalty status</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(token);
        }}
      >
        <label>
          Card code
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your card code"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={loading || !token.trim()}>
          {loading ? 'Checking…' : 'Check status'}
        </button>
      </form>

      {/* Manual-entry errors only matter when there's no card to show. */}
      {!cardToken && error && <p className="error">{error}</p>}
      {!cardToken && (
        <p className="muted small">
          Lost your card?&nbsp;<Link to="/recover">Recover it by email</Link>.
        </p>
      )}

      {cardToken && (
        <div className="status-result">
          {state?.customer.displayName && <p className="hello">Hi, {state.customer.displayName}!</p>}

          <ReviewPrompt
            hasRedemption={Boolean(state?.transactions.some((t) => t.type === 'redemption'))}
          />

          <QrDisplay
            payload={cardPayload(cardToken)}
            label="Your card QR"
            caption="Show this at the till"
          />
          <div className="wallet-stubs">
            <WalletButton token={cardToken} />
          </div>

          {state ? (
            <>
              <p className="balance-line">
                <strong>{state.balance}</strong> point{state.balance === 1 ? '' : 's'}
              </p>
              <ProgressBar progress={state.progress} />
              {state.rewardAvailable ? (
                <p className="reward-ready">
                  🎉 You've earned a reward: <strong>{state.config.rewardDescription}</strong>. Show
                  your card at the till.
                </p>
              ) : (
                <p className="muted">
                  {state.config.pointsPerReward - state.progress.current} more for{' '}
                  {state.config.rewardDescription}.
                </p>
              )}

              {/* B1: device persistence (remember/forget) — distinct from account deletion. */}
              <RememberControl
                token={cardToken}
                recoverable={Boolean(state.customer.email || state.customer.displayName)}
              />

              <button
                type="button"
                className="link danger"
                title="This deletes your loyalty account and your card."
                onClick={() => navigate(`/delete/${state.customer.token}`)}
              >
                Delete my card
              </button>
            </>
          ) : (
            <>
              <RememberControl token={cardToken} recoverable />
              <p className="muted">
                {loading
                  ? 'Checking…'
                  : 'Show this code at the till — your points appear here the moment staff add them.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
