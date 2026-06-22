/**
 * CustomerHome — the base-URL landing.
 *
 * Decides where an arriving visitor goes:
 *  1. An authenticated staff/admin session takes precedence (A4): never
 *     auto-display a customer card on a staff device → go to the staff area.
 *  2. A recognized browser (IdentityStore holds a token) → straight to its card.
 *  3. Otherwise (no card on this device) → straight into the join form. Recovery
 *     ("lost my card") is a small link at the end of that form.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import { SelfRegister } from './SelfRegister';

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

  // No card on this device → open the join form directly.
  return <SelfRegister />;
}
