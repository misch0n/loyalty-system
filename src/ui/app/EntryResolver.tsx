/**
 * Entry resolution (UX-SPEC §2).
 *
 * On mount, decide where to send the visitor and render a redirect:
 *   trusted staff device + session 'active'  → /staff
 *   trusted staff device + 'locked'          → /staff/unlock
 *   device has a remembered card (identity)  → /card/:token
 *   otherwise                                → /welcome
 *
 * Staff identity/timeout comes from useAuth(); the remembered card comes from
 * services.identity.get() (token only — never PII). A minimal loading state is
 * shown while auth boot and the identity read settle.
 */

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { useAuth } from './AuthContext';
import { ROUTES, cardPath } from './routes';

/**
 * Resolve the entry target. Returns `null` while still deciding (auth not yet
 * settled or the identity read in flight). Factored out so callers that need the
 * raw path string can reuse the logic.
 */
export function useEntryTarget(): string | null {
  const services = useServices();
  const { actor, status, trusted, ready } = useAuth();

  // null = not yet read; '' = read, no remembered card; string = the token.
  const [cardToken, setCardToken] = useState<string | null>(null);

  // A trusted device that is active or locked routes to staff without ever
  // needing the identity read, so only fetch the card when we might use it.
  // Gate on `ready` so we don't act on the pre-boot 'anon' default.
  const staffTarget = ready && trusted && status === 'active';
  const staffLocked = ready && trusted && status === 'locked';
  const needCard = ready && !staffTarget && !staffLocked;

  useEffect(() => {
    if (!needCard) return;
    let cancelled = false;
    void services.identity
      .get()
      .then((token) => {
        if (!cancelled) setCardToken(token ?? '');
      })
      .catch(() => {
        if (!cancelled) setCardToken('');
      });
    return () => {
      cancelled = true;
    };
  }, [services, needCard]);

  // Auth boot not settled yet.
  if (!ready) return null;
  // Home is role-aware: an admin lands on the admin panel, staff on the counter.
  if (staffTarget) return actor?.role === 'admin' ? ROUTES.admin : ROUTES.staff;
  if (staffLocked) return ROUTES.staffUnlock;

  // Still resolving the remembered card.
  if (cardToken === null) return null;
  if (cardToken) return cardPath(cardToken);
  return ROUTES.welcome;
}

export function EntryResolver(): JSX.Element {
  const target = useEntryTarget();

  // `null` = still resolving (auth boot and/or the identity read in flight).
  if (target === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--ink-soft)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
        }}
      >
        Loading…
      </div>
    );
  }

  return <Navigate to={target} replace />;
}
