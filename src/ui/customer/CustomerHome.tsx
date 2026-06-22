/**
 * CustomerHome — the base-URL landing.
 *
 * Decides where an arriving visitor goes:
 *  1. An authenticated staff/admin session takes precedence (A4): never
 *     auto-display a customer card on a staff device → go to the staff area.
 *  2. A recognized browser (IdentityStore holds a token) → straight to its card.
 *  3. Otherwise show the landing: self-register, recover, or staff sign-in.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';

export function CustomerHome() {
  const { identity } = useServices();
  const { actor } = useSession();
  const navigate = useNavigate();
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Staff/admin session wins — suppress customer auto-display.
      if (actor) {
        navigate('/staff', { replace: true });
        return;
      }
      const token = await identity.get();
      if (!cancelled && token) {
        navigate(`/status/${token}`, { replace: true });
        return;
      }
      if (!cancelled) setDecided(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [actor, identity, navigate]);

  if (!decided) {
    return <div className="card">Loading…</div>;
  }

  return (
    <div className="card customer-home">
      <h1>Café Loyalty</h1>
      <p>Collect a point with every coffee and earn free drinks. No app to install.</p>

      <div className="actions-row">
        <Link className="button primary" to="/register">
          Join now
        </Link>
        <Link className="button" to="/recover">
          Lost my card
        </Link>
      </div>

      <p className="muted small">
        Already have your card open on another device? Just scan its QR at the till.
      </p>
      <p className="muted small">
        Staff?&nbsp;<Link to="/login">Sign in</Link>.
      </p>
    </div>
  );
}
