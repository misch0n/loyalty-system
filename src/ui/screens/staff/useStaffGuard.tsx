/**
 * Shared entry guard for the authenticated staff screens (UI-SPEC §4.8/§4.9,
 * UX-SPEC §6).
 *
 * Both the staff panel and the scan workflow share the same gate:
 *   - not ready yet            → a loading element (don't act on the pre-boot
 *                                'anon' default)
 *   - locked trusted device    → redirect to the PIN unlock screen
 *   - anonymous / no actor      → redirect to the staff sign-in screen
 *   - active with an actor      → `actor` is returned and the screen renders
 *
 * Returns either a `redirect` element to render immediately, or the live
 * `actor`. Keeping this in one place stops the two screens drifting apart.
 */

import type { JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { ROUTES } from '../../app/routes';
import type { Actor } from '../../../services/types';

export type StaffGuardResult =
  | { actor: Actor; redirect: null }
  | { actor: null; redirect: JSX.Element };

export function useStaffGuard(): StaffGuardResult {
  const { actor, status, ready } = useAuth();

  if (!ready) {
    return {
      actor: null,
      redirect: (
        <div className="staff-screen" role="status" aria-live="polite">
          <div className="staff-screen__col staff-auth">
            <p className="staff-auth__sub">Loading…</p>
          </div>
        </div>
      ),
    };
  }

  if (status === 'locked') {
    return { actor: null, redirect: <Navigate to={ROUTES.staffUnlock} replace /> };
  }

  if (status === 'anon' || !actor) {
    return { actor: null, redirect: <Navigate to={ROUTES.login} replace /> };
  }

  return { actor, redirect: null };
}
