/**
 * Entry resolution (UX-SPEC §2).
 *
 * On mount, decide where to send the visitor and render a redirect:
 *   signed-in staff/admin                    → /staff
 *   device has a remembered card (identity)  → /card/:token
 *   otherwise                                → /welcome
 *
 * Staff identity comes from useAuth(); the remembered card comes from
 * services.identity.get() (token only — never PII). A minimal loading state is
 * shown while auth boot and the identity read settle.
 *
 * "No card on this device" is an answer, not a failure: `GET /me` returns
 * `{ token: null }` and `identity.get()` resolves `null` → /welcome. A *thrown*
 * read means the server could not be asked, which says nothing about whether
 * this phone has a card — so it must never land on "Create your card" (UI-4).
 * Instead a small screen says what happened, that the card is safe, and offers
 * **Try again**, which re-runs the read. A connectivity failure (offline / 5xx)
 * gets that one action; anything else is unexpected here and may not clear on a
 * retry, so it also offers the welcome page as a way on rather than a dead end.
 */

import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eyebrow, Title, Sub } from '../components/Heading/Heading';
import { Button } from '../components/Button/Button';
import { useServices } from '../common/ServicesContext';
import { failureMessage, isConnectivityFailure } from '../common/failure';
import { useAuth } from './AuthContext';
import { ROUTES, cardPath } from './routes';

/** What the identity read came back with. */
type CardRead =
  | { status: 'pending' }
  | { status: 'done'; token: string | null }
  | { status: 'failed'; error: unknown; retrying: boolean };

export interface EntryResolution {
  /** Where to go, or `null` while still deciding or after a failed read. */
  target: string | null;
  /** The identity read's failure, when it threw; `null` otherwise. */
  failure: unknown;
  /** True while a read (first or retry) is in flight. */
  checking: boolean;
  /** Run the identity read again. */
  retry(): void;
}

/**
 * Resolve the entry target. `target` is `null` while still deciding (auth not
 * yet settled or the identity read in flight) and when the read failed.
 */
export function useEntryResolution(): EntryResolution {
  const services = useServices();
  const { status, ready } = useAuth();

  const [read, setRead] = useState<CardRead>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);

  // An ACTIVE staff/admin session routes to its panel — remembered or not — so a
  // signed-in staffer is never dropped onto the customer card. Gate on `ready` so
  // we don't act on the pre-boot 'anon' default.
  const staffTarget = ready && status === 'active';
  const needCard = ready && !staffTarget;

  useEffect(() => {
    if (!needCard) return;
    let cancelled = false;
    services.identity
      .get()
      .then((token) => {
        if (!cancelled) setRead({ status: 'done', token: token ?? null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setRead({ status: 'failed', error, retrying: false });
      });
    return () => {
      cancelled = true;
    };
  }, [services, needCard, attempt]);

  // A retry keeps the failure on screen (button busy) until the new answer lands.
  const retry = useCallback(() => {
    setRead((r) => (r.status === 'failed' ? { ...r, retrying: true } : r));
    setAttempt((n) => n + 1);
  }, []);

  let target: string | null = null;
  // Both staff and admins land on the counter; admins reach the admin panel via
  // the "Go to admin" button there.
  if (staffTarget) target = ROUTES.staff;
  else if (ready && read.status === 'done') {
    target = read.token ? cardPath(read.token) : ROUTES.welcome;
  }

  return {
    target,
    failure: !staffTarget && read.status === 'failed' ? read.error : null,
    checking: read.status === 'pending' || (read.status === 'failed' && read.retrying),
    retry,
  };
}

/** The resolved path alone (`null` while deciding or after a failed read). */
export function useEntryTarget(): string | null {
  return useEntryResolution().target;
}

/** The connectivity copy says the card is safe; the server owns it, not the phone. */
const CHECK_FAILED: Parameters<typeof failureMessage>[2] = {
  offline:
    'Couldn’t reach the café’s server. Your card is safe — try again when you’re back online.',
  server: 'The café’s server had a problem just now. Your card is safe — try again in a moment.',
};

export function EntryResolver(): JSX.Element {
  const navigate = useNavigate();
  const { target, failure, checking, retry } = useEntryResolution();

  if (failure !== null) {
    const connectivity = isConnectivityFailure(failure);
    return (
      <div className="screen bg-cream">
        <div className="screen-pad">
          <Eyebrow>Ckyka rewards</Eyebrow>
          <Title>We couldn’t check for your card</Title>
          <Sub>
            <span role="alert">
              {failureMessage(
                failure,
                'Something went wrong while checking for your card. Try again.',
                CHECK_FAILED,
              )}
            </span>
          </Sub>
          <div className="stack-sm" style={{ marginTop: 24 }}>
            <Button variant="forest" disabled={checking} onClick={retry}>
              {checking ? 'Trying…' : 'Try again'}
            </Button>
            {!connectivity && (
              <Button variant="ghost" onClick={() => navigate(ROUTES.welcome)}>
                Go to the welcome page
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

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
