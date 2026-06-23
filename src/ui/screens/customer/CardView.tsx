/**
 * CardView — the customer hub (UI-SPEC §4.4, UX-SPEC §4.2).
 *
 * Reads derived state via `loyalty.getStateByToken(token)` and renders the kit
 * Card: member name, cup stamps bound to the program threshold (NOT a hardcoded
 * 10), a progress note, and a tappable QR tile that opens the enlarged overlay.
 * A discreet "⋯" affordance (corner, never on the card face) opens the card menu.
 *
 * States: loading (skeleton), collecting (partial), reward-ready (sage variant +
 * banner), offline (quiet banner, still render last-known state), and viewing a
 * non-owned card (read-only contextual banner; the device's saved card is NOT
 * overwritten).
 *
 * Live refresh: refetches on `usePairing().dataVersion` so staff credits show up.
 * The customer device only displays — accrual is staff-gated.
 *
 * `/card` (no token) self-resolves the saved token from IdentityStore and
 * redirects to `cardPath(token)`, or to Welcome when nothing is saved.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Button, CupStamps, Eyebrow } from '../../kit';
import { Card } from '../../kit';
import { ROUTES, cardPath } from '../../app/routes';
import { useServices } from '../../common/ServicesContext';
import { usePairing } from '../../common/PairingContext';
import { cardPayload, toDataUrl } from '../../../qr/encode';
import type { CustomerState } from '../../../services/LoyaltyService';
import { EnlargedQrOverlay } from './EnlargedQrOverlay';
import { CardMenu } from './CardMenu';

type Phase = 'loading' | 'ready' | 'missing';

export function CardView() {
  const { token: routeToken } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { loyalty, identity } = useServices();
  const { dataVersion } = usePairing();

  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<CustomerState | null>(null);
  const [offline, setOffline] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const resolvingRef = useRef(false);

  const refreshSaved = useCallback(() => {
    void identity.get().then(setSavedToken);
  }, [identity]);

  // Self-resolve `/card` → `/card/:token` from the remembered card.
  useEffect(() => {
    if (routeToken || resolvingRef.current) return;
    resolvingRef.current = true;
    void identity.get().then((saved) => {
      if (saved) navigate(cardPath(saved), { replace: true });
      else navigate(ROUTES.welcome, { replace: true });
    });
  }, [routeToken, identity, navigate]);

  // Track the saved card so we can detect a non-owned view + drive the menu.
  useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  // Fetch derived state; refetch live on data changes (staff credits).
  useEffect(() => {
    if (!routeToken) return;
    let active = true;
    void loyalty
      .getStateByToken(routeToken)
      .then((next) => {
        if (!active) return;
        setOffline(false);
        if (!next) {
          setPhase('missing');
          setState(null);
          return;
        }
        setState(next);
        setPhase('ready');
      })
      .catch(() => {
        if (!active) return;
        // Transport down: keep last-known derived state, show a quiet banner.
        setOffline(true);
        setPhase((p) => (p === 'loading' ? 'loading' : p));
      });
    return () => {
      active = false;
    };
  }, [routeToken, loyalty, dataVersion]);

  // Render the card-face QR (the card URL, never PII).
  useEffect(() => {
    if (!routeToken) return;
    let active = true;
    void toDataUrl(cardPayload(routeToken)).then((url) => {
      if (active) setQr(url);
    });
    return () => {
      active = false;
    };
  }, [routeToken]);

  if (!routeToken || phase === 'loading') {
    return (
      <main className="screen card-view safe-inset" aria-busy="true">
        <div className="card-view__skeleton" aria-hidden="true" />
      </main>
    );
  }

  if (phase === 'missing' && !state) {
    return (
      <main className="screen card-view safe-inset">
        <header className="screen__head">
          <Eyebrow>Card</Eyebrow>
          <h1 className="screen__title">We couldn’t find this card</h1>
          <p className="screen__sub">
            This card code doesn’t match an active card here. Create a new card or recover an
            existing one.
          </p>
        </header>
        <div className="card-view__actions">
          <Button variant="forest" size="lg" block onClick={() => navigate(ROUTES.register)}>
            Create a card
          </Button>
          <Button variant="ghost" onClick={() => navigate(ROUTES.lost)}>
            I already have one
          </Button>
        </div>
      </main>
    );
  }

  if (!state) return null;

  const { customer, progress, rewardAvailable } = state;
  const name = customer.displayName || 'Your card';
  const owned = savedToken === routeToken;
  const remaining = Math.max(progress.threshold - progress.current, 0);

  return (
    <main className="screen card-view safe-inset">
      {offline && (
        <Banner tone="offline">
          You’re offline — showing your card as it was last seen. It’ll refresh when you reconnect.
        </Banner>
      )}

      {!owned && (
        <Banner tone="info">
          Viewing {customer.displayName ? `${customer.displayName}’s` : 'this'} card. It won’t replace
          the card saved on this device.
        </Banner>
      )}

      <div className="card-view__corner">
        <button
          type="button"
          className="card-view__more"
          aria-label="Card options"
          onClick={() => setMenuOpen(true)}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>

      <Card
        name={name}
        variant={rewardAvailable ? 'reward' : 'collecting'}
        rewardBanner="Show this at the counter to redeem."
      >
        <CupStamps filled={progress.current} total={progress.threshold} />

        <p className="card-view__progress">
          {rewardAvailable
            ? 'Free coffee ready.'
            : `${remaining} more for a free coffee`}
          <span className="card-view__count">
            {progress.current} / {progress.threshold}
          </span>
        </p>

        <button
          type="button"
          className="card-view__qr"
          aria-label="Enlarge your card code"
          onClick={() => setEnlarged(true)}
        >
          {qr ? (
            <img src={qr} alt="Your card code" className="card-view__qr-img" />
          ) : (
            <span className="card-view__qr-placeholder" aria-hidden="true" />
          )}
        </button>
      </Card>

      <p className="card-view__hint">Tap your code to enlarge it or add it to your wallet.</p>

      <EnlargedQrOverlay
        open={enlarged}
        onClose={() => setEnlarged(false)}
        customerId={customer.id}
        token={routeToken}
        name={name}
      />

      <CardMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        customer={customer}
        saved={owned}
        onSavedChange={refreshSaved}
      />
    </main>
  );
}

export default CardView;
