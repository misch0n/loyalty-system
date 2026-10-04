/**
 * Card — the customer hub (Ckyka reference views 04 collecting + 05 reward).
 *
 * Reads derived state via `loyalty.getStateByToken(token)` and renders the
 * shared LoyaltyCard: member name, cup stamps bound to the program threshold
 * (NOT a hardcoded 10), a progress note, and a tappable QR tile that opens the
 * enlarged overlay. A discreet "⋯" affordance (corner) opens the card menu.
 *
 * Background: blush while collecting, sage once the reward is available. `/card`
 * (no token) self-resolves from IdentityStore, and goes to welcome when the
 * device is not bound.
 *
 * Failure states (UI-4 — a customer never meets a dead end or an endless
 * skeleton; each failure says what happened, that the card is safe where that
 * is true, and offers one action):
 *   - **First load fails** (or the `/card` self-resolve cannot ask) → an error
 *     state with the {@link failureMessage} sentence and **Try again**. Never
 *     welcome: a phone that is merely offline must not be told to make a card.
 *   - **The card is gone** — `null` from the lookup, or a thrown `not_found` →
 *     the "We couldn't find this card" state.
 *   - **A refresh fails while a card is on screen** → the last-known card
 *     stays. A connectivity failure (offline / 5xx) adds a quiet banner saying
 *     the card is shown as last seen, with Try again; the next success clears
 *     it. Any other kind stays silent: the server answered, so the connection
 *     is fine, and the card on screen is still the best thing to show.
 *
 * Opening a card link **is** binding it: `GET /customers/by-token/:token` sets
 * this device's identity cookie to the card it shows (`UI-RECONCILIATION.md`
 * C6). So there is no "viewing someone else's card" state any more — the
 * card on screen is the card this device remembers.
 *
 * LIVENESS: the pairing `dataVersion` this screen used to refetch on went with
 * the pairing layer (UI-0). Until the SSE subscriber lands (UI-5) the card is
 * fetched once per mount, so a staff credit shows on the next visit or reload.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Button } from '../../../components/Button/Button';
import { LoyaltyCard } from '../../../components/LoyaltyCard/LoyaltyCard';
import { ContextBanner } from '../../../components/ContextBanner/ContextBanner';
import { FindUs } from '../../../components/FindUs/FindUs';
import { formatShortCode } from '@cafe/shared/domain/tokens';
import { LogoMark } from '../../../components/Logo/Logo';
import { GestureLogo } from '../../../app/LogoGestures';
import { ROUTES, cardPath } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { failureMessage, isConnectivityFailure, type FailureOverrides } from '../../../common/failure';
import { isApiError } from '../../../../services/errors';
import type { CustomerState } from '../../../../services/LoyaltyService';
import { EnlargedQr } from '../EnlargedQr/EnlargedQr';
import { CardMenu } from '../CardMenu/CardMenu';
import './Card.css';

type Phase = 'loading' | 'ready' | 'missing' | 'failed';

/** The card lives on the server, so a connection failure never touches it. */
const LOAD_FAILED: FailureOverrides = {
  offline:
    'Couldn’t reach the café’s server. Your card and cups are safe — try again when you’re back online.',
  server:
    'The café’s server had a problem just now. Your card and cups are safe — try again in a moment.',
};

/** The banner over a last-known card when a refresh could not reach the server. */
function staleMessage(err: unknown): string {
  return isApiError(err) && err.failure.kind === 'server'
    ? 'The café’s server had a problem — showing your card as it was last seen. Your cups are safe.'
    : 'You’re offline — showing your card as it was last seen. Your cups are safe.';
}

export function Card() {
  const { token: routeToken } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { loyalty, identity } = useServices();

  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<CustomerState | null>(null);
  // Why the first load failed (phase 'failed').
  const [failure, setFailure] = useState<unknown>(null);
  // A refresh's connectivity failure while a card is on screen (the banner).
  const [stale, setStale] = useState<unknown>(null);
  // A load (first, retry or refresh) is in flight.
  const [busy, setBusy] = useState(false);
  // Bumped by Try again; re-runs the self-resolve or the fetch.
  const [attempt, setAttempt] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  // The enlarged QR opens in two modes: the plain card view (tap the QR) and a
  // special "redeem" view (tap a reward entry) — which shows the REWARD QR for
  // the reward token(s) the card selected.
  const [redeemMode, setRedeemMode] = useState(false);
  const [redeemTokens, setRedeemTokens] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  // The token of the card on screen, if any: a failed fetch for *that* token is
  // a refresh (keep the card), anything else is a first load.
  const shownRef = useRef<string | null>(null);

  const retry = () => setAttempt((n) => n + 1);

  // Self-resolve `/card` → `/card/:token` from the remembered card.
  useEffect(() => {
    if (routeToken) return;
    let active = true;
    setBusy(true);
    identity
      .get()
      .then((saved) => {
        if (!active) return;
        navigate(saved ? cardPath(saved) : ROUTES.welcome, { replace: true });
      })
      .catch((err: unknown) => {
        if (!active) return;
        // Could not ask — not "no card". Never send an offline phone to welcome.
        setFailure(err);
        setPhase('failed');
        setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [routeToken, identity, navigate, attempt]);

  // A different card starts from the skeleton, never over the last one.
  useEffect(() => {
    shownRef.current = null;
    setState(null);
    setStale(null);
    setFailure(null);
    setPhase('loading');
  }, [routeToken]);

  // Fetch derived state. Live refetch returns with the SSE subscriber (UI-5).
  useEffect(() => {
    if (!routeToken) return;
    let active = true;

    const showMissing = () => {
      shownRef.current = null;
      setState(null);
      setStale(null);
      setPhase('missing');
    };

    setBusy(true);
    void (async () => {
      try {
        const found = await loyalty.getStateByToken(routeToken);
        if (!active) return;
        if (!found) {
          showMissing();
          return;
        }
        // Resolve token → id, then read the reward-aware state (settled balance +
        // discrete unspent rewards) — the same path the staff Scan uses.
        const fresh = await loyalty.getState(found.customer.id);
        if (!active) return;
        shownRef.current = routeToken;
        setState(fresh);
        setFailure(null);
        setStale(null);
        setPhase('ready');
      } catch (err) {
        if (!active) return;
        if (isApiError(err) && err.failure.kind === 'not_found') {
          showMissing();
        } else if (shownRef.current === routeToken) {
          // A refresh: keep the last-known card. Only a connectivity failure is
          // worth a banner; any answer from the server means the connection is
          // back, so it also clears one.
          setStale(isConnectivityFailure(err) ? err : null);
        } else {
          setFailure(err);
          setPhase('failed');
        }
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [routeToken, loyalty, attempt]);

  if (phase === 'failed') {
    return (
      <div className="screen bg-blush">
        <div className="screen-pad">
          <Eyebrow>Your Ckyka card</Eyebrow>
          <Title>We couldn’t load your card</Title>
          <Sub>
            <span role="alert">
              {failureMessage(failure, 'Something went wrong loading your card. Try again.', LOAD_FAILED)}
            </span>
          </Sub>
          <div className="card-missing-actions stack-sm">
            <Button variant="forest" disabled={busy} onClick={retry}>
              {busy ? 'Trying…' : 'Try again'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!routeToken || phase === 'loading') {
    return (
      <div className="screen bg-blush" aria-busy="true">
        <div className="screen-pad">
          <div className="card-skeleton" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (phase === 'missing' && !state) {
    return (
      <div className="screen bg-cream">
        <div className="screen-pad">
          <Eyebrow>Card</Eyebrow>
          <Title>We couldn’t find this card</Title>
          <Sub>
            This card code doesn’t match an active card here. Create a new card or recover an
            existing one.
          </Sub>
          <div className="card-missing-actions stack-sm">
            <Button variant="forest" onClick={() => navigate(ROUTES.register)}>
              Create a card
            </Button>
            <Button variant="ghost" onClick={() => navigate(ROUTES.lost)}>
              I already have one
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const { customer, progress } = state;
  const rewards = state.rewards ?? [];
  const rewardReady = rewards.length > 0;
  const name = customer.displayName || 'Your card';
  const code = `CKY · ${formatShortCode(customer.shortCode)}`;

  return (
    <div className={`screen ${rewardReady ? 'bg-sage' : 'bg-blush'}`}>
      <div className="screen-pad card-main">
        <div className="card-topline">
          <Eyebrow className="center card-eyebrow">Your Ckyka card</Eyebrow>
          <GestureLogo className="card-gesture">
            <LogoMark size="sm" />
          </GestureLogo>
        </div>

        {stale !== null && (
          <div className="card-banner" role="status">
            <ContextBanner
              toggle={
                <button
                  type="button"
                  className="card-banner-retry"
                  disabled={busy}
                  onClick={retry}
                >
                  {busy ? 'Trying…' : 'Try again'}
                </button>
              }
            >
              {staleMessage(stale)}
            </ContextBanner>
          </div>
        )}

        <div className="card-gap" />

        <LoyaltyCard
          name={name}
          filled={progress.current}
          total={progress.threshold}
          token={routeToken}
          code={code}
          rewards={rewards}
          onEnlarge={() => {
            setRedeemMode(false);
            setEnlarged(true);
          }}
          onRedeem={(tokens) => {
            setRedeemTokens(tokens);
            setRedeemMode(true);
            setEnlarged(true);
          }}
          onMenu={() => setMenuOpen(true)}
        />

        <p className="card-hint">
          {rewardReady
            ? 'Show your free coffee at the counter — tap the reward to enlarge it.'
            : 'Tap your code to enlarge it for the counter.'}
        </p>
        <div className="spacer" />
        <div className="card-scroll-hint">scroll for hours &amp; location ↓</div>
      </div>

      <FindUs />

      <EnlargedQr
        open={enlarged}
        onClose={() => setEnlarged(false)}
        token={routeToken}
        name={name}
        code={code}
        redeem={redeemMode}
        rewardTokens={redeemTokens}
      />

      <CardMenu open={menuOpen} onClose={() => setMenuOpen(false)} token={routeToken} />
    </div>
  );
}

export default Card;
