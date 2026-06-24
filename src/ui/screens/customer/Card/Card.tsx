/**
 * Card — the customer hub (Ckyka reference views 04 collecting + 05 reward).
 *
 * Reads derived state via `loyalty.getStateByToken(token)` and renders the
 * shared LoyaltyCard: member name, cup stamps bound to the program threshold
 * (NOT a hardcoded 10), a progress note, and a tappable QR tile that opens the
 * enlarged overlay. A discreet "⋯" affordance (corner) opens the card menu.
 *
 * Background: blush while collecting, sage once the reward is available. States:
 * loading (skeleton), collecting, reward-ready, offline (quiet banner, keep
 * last-known state), and viewing a non-owned card (read-only banner; the saved
 * card is not overwritten). Refetches on `usePairing().dataVersion` so staff
 * credits show up live. `/card` (no token) self-resolves from IdentityStore.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Button } from '../../../components/Button/Button';
import { LoyaltyCard } from '../../../components/LoyaltyCard/LoyaltyCard';
import { ContextBanner } from '../../../components/ContextBanner/ContextBanner';
import { FindUs } from '../../../components/FindUs/FindUs';
import { formatShortCode } from '../../../../domain/tokens';
import { LogoMark } from '../../../components/Logo/Logo';
import { GestureLogo } from '../../../app/LogoGestures';
import { ROUTES, cardPath } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { usePairing } from '../../../common/PairingContext';
import type { CustomerState } from '../../../../services/LoyaltyService';
import { EnlargedQr } from '../EnlargedQr/EnlargedQr';
import { CardMenu } from '../CardMenu/CardMenu';
import './Card.css';

type Phase = 'loading' | 'ready' | 'missing';

export function Card() {
  const { token: routeToken } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { loyalty, identity } = useServices();
  const { dataVersion } = usePairing();

  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<CustomerState | null>(null);
  const [offline, setOffline] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);
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

  const { customer, progress, rewardAvailable } = state;
  const name = customer.displayName || 'Your card';
  const owned = savedToken === routeToken;
  const code = `CKY · ${formatShortCode(customer.shortCode)}`;

  return (
    <div className={`screen ${rewardAvailable ? 'bg-sage' : 'bg-blush'}`}>
      <div className="screen-pad card-main">
        <div className="card-topline">
          <Eyebrow className="center card-eyebrow">Your Ckyka card</Eyebrow>
          <GestureLogo className="card-gesture">
            <LogoMark size="sm" />
          </GestureLogo>
        </div>

        {offline && (
          <div className="card-banner">
            <ContextBanner>
              You’re offline — showing your card as it was last seen. It’ll refresh when you
              reconnect.
            </ContextBanner>
          </div>
        )}

        {!owned && (
          <div className="card-banner">
            <ContextBanner>
              Viewing {customer.displayName ? `${customer.displayName}’s` : 'this'} card. It
              won’t replace the card saved on this device.
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
          rewardReady={rewardAvailable}
          onEnlarge={() => setEnlarged(true)}
          onMenu={() => setMenuOpen(true)}
        />

        <p className="card-hint">
          {rewardAvailable
            ? 'Enjoy — your card resets after this one.'
            : 'Tap your code to enlarge it or add it to your wallet.'}
        </p>
        <div className="spacer" />
        <div className="card-scroll-hint">scroll for hours &amp; location ↓</div>
      </div>

      <FindUs />

      <EnlargedQr
        open={enlarged}
        onClose={() => setEnlarged(false)}
        customerId={customer.id}
        token={routeToken}
        name={name}
        code={code}
      />

      <CardMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        customer={customer}
        saved={owned}
        onSavedChange={refreshSaved}
        token={routeToken}
      />
    </div>
  );
}

export default Card;
