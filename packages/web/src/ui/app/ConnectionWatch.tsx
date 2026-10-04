/**
 * The global half of the failure routing (`UI-RECONCILIATION.md` X2).
 *
 * Listens to every API answer through `services.connection` and handles the two
 * failure scopes that are nobody's screen's job:
 *
 *   - **session** — a staff session that has ended (TTL, "Sign out all
 *     devices", account disabled or deleted). The signed-in state is cleared
 *     and the device goes to sign-in, from here and nowhere else. A device with
 *     no staff signed in ignores it: there is no session of its to end.
 *   - **connectivity** — no answer, or a 5xx. A persistent banner goes up and
 *     stays until the server answers anything again; it has no dismiss, because
 *     a banner you can close is a banner you forget is true.
 *
 * **Action** failures are deliberately ignored here — they belong on the field
 * or control that caused them (UI-4). The point of action also reports a
 * connectivity failure in its own terms (UI-4); this banner does not replace
 * that, because it cannot say whether the points landed.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { failureScope } from '../../services/errors';
import { useServices } from '../common/ServicesContext';
import { useAuth } from './AuthContext';
import { ROUTES } from './routes';
import './connection-watch.css';

export function ConnectionWatch({ children }: { children: ReactNode }): JSX.Element {
  const { connection } = useServices();
  const { actor, logout } = useAuth();
  const navigate = useNavigate();
  const [unreachable, setUnreachable] = useState(false);

  // Read through a ref so the subscription is made once, not on every sign-in.
  const latest = useRef({ actor, logout, navigate });
  latest.current = { actor, logout, navigate };

  useEffect(
    () =>
      connection.subscribe((event) => {
        if (event.type === 'reachable') {
          setUnreachable(false);
          return;
        }
        const scope = failureScope(event.error.failure);
        if (scope === 'connectivity') {
          setUnreachable(true);
        } else if (scope === 'session' && latest.current.actor) {
          latest.current.logout();
          latest.current.navigate(ROUTES.login, { replace: true });
        }
      }),
    [connection],
  );

  return (
    <>
      {unreachable && (
        <div className="connection-banner" role="status" aria-live="polite">
          Can’t reach the server. Check this device’s internet connection.
        </div>
      )}
      {children}
    </>
  );
}
