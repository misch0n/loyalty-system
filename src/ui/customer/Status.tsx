/**
 * Status — the customer web check-up. Look up loyalty state by token (the QR
 * payload), with no account or password. Also the entry point to delete data.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { ProgressBar } from '../common/Progress';
import type { CustomerState } from '../../services/LoyaltyService';

export function Status() {
  const { token: tokenParam } = useParams<{ token: string }>();
  const { loyalty, identity } = useServices();
  const navigate = useNavigate();

  const [token, setToken] = useState(tokenParam ?? '');
  const [state, setState] = useState<CustomerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      // Remember this browser so the base URL routes straight here next time.
      await identity.set(result.customer.token);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tokenParam) lookup(tokenParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam]);

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

      {error && <p className="error">{error}</p>}
      {!state && (
        <p className="muted small">
          Lost your card?&nbsp;<Link to="/recover">Recover it by email</Link>.
        </p>
      )}

      {state && (
        <div className="status-result">
          {state.customer.displayName && <p className="hello">Hi, {state.customer.displayName}!</p>}
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

          <button
            type="button"
            className="link danger"
            onClick={() => navigate(`/delete/${state.customer.token}`)}
          >
            Delete my data
          </button>
        </div>
      )}
    </div>
  );
}
