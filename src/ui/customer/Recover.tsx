/**
 * Recover — customer self-service "lost my card".
 *
 *  - `/recover`        : enter a registered email → emailed a single-use link.
 *  - `/recover/:code`  : opening the emailed link consumes the code and
 *                        re-establishes identity on this browser, then routes to
 *                        the card. The link IS the login (no password).
 *
 * To avoid an account-enumeration oracle, the request screen always shows the
 * same confirmation whether or not the email matched.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';

export function Recover() {
  const { code } = useParams<{ code: string }>();
  return code ? <RecoverConsume code={code} /> : <RecoverRequest />;
}

function RecoverRequest() {
  const { recovery } = useServices();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await recovery.request(email);
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card">
        <h1>Check your email</h1>
        <p>
          If that address has a card, we've sent a single-use link to restore it. It
          expires shortly. Open it on the device you want to use.
        </p>
        <p className="muted small">
          Didn't get it? Token-only cards (no email) can't be recovered this way — ask
          staff at the till.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Recover your card</h1>
      <p className="muted">Enter the email you registered with and we'll send a link.</p>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>
        <button type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Send recovery link'}
        </button>
      </form>
      <p className="muted small">
        New here?&nbsp;<Link to="/register">Join the scheme</Link>.
      </p>
    </div>
  );
}

function RecoverConsume({ code }: { code: string }) {
  const { recovery, identity } = useServices();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard StrictMode double-invoke (codes are single-use)
    ran.current = true;
    (async () => {
      const result = await recovery.redeem(code);
      if (!result) {
        setFailed(true);
        return;
      }
      await identity.set(result.token);
      navigate(`/status/${result.token}`, { replace: true });
    })();
  }, [code, recovery, identity, navigate]);

  if (failed) {
    return (
      <div className="card">
        <h1>That link didn't work</h1>
        <p>It may have expired or already been used. Recovery links are single-use.</p>
        <Link className="button" to="/recover">
          Request a new link
        </Link>
      </div>
    );
  }

  return <div className="card">Restoring your card…</div>;
}
