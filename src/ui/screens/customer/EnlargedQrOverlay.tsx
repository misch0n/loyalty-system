/**
 * EnlargedQrOverlay — the full-surface enlarged QR + wallet button (UI-SPEC §4.5,
 * UX-SPEC §4.3).
 *
 * Opened by tapping the QR on the card; CardView owns the open state. A large,
 * high-contrast QR plus the member name and a short code (first 6 of the token,
 * never PII). ONE OS-aware wallet button, MOBILE ONLY — hidden on desktop, where
 * the QR itself is the "scan with your phone" path. On tap it mints/ensures the
 * pass via `wallet.ensurePass(customer.id)` and opens the OS-appropriate URL.
 *
 * Liveness caveat (Free tier): the pass is a static snapshot, so the copy must
 * NOT imply it auto-updates — the web card stays the source of truth.
 */

import { useEffect, useState } from 'react';
import { Button, Eyebrow, Overlay } from '../../kit';
import { useServices } from '../../common/ServicesContext';
import { cardPayload, toDataUrl } from '../../../qr/encode';
import { detectWalletKind } from '../../../wallet/passes';

export interface EnlargedQrOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Internal customer id — used to ensure/mint the wallet pass. */
  customerId: string;
  /** Opaque card token — drives the QR payload and the short code. */
  token: string;
  /** Member display name, or a neutral fallback. */
  name: string;
}

type WalletPhase = 'idle' | 'working' | 'error';

/**
 * Mobile heuristic for showing the wallet button: a touch device on a small-ish
 * viewport. Desktop (no touch / large viewport) gets the QR only. An ambiguous
 * platform still resolves to a wallet kind via `detectWalletKind`, and the
 * button routes to that wallet's hosted URL rather than guessing wrong.
 */
function isMobileSurface(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  const narrow = window.matchMedia?.('(max-width: 820px)').matches ?? false;
  return (coarse || touch) && narrow;
}

export function EnlargedQrOverlay({ open, onClose, customerId, token, name }: EnlargedQrOverlayProps) {
  const { wallet } = useServices();
  const [qr, setQr] = useState<string | null>(null);
  const [phase, setPhase] = useState<WalletPhase>('idle');
  const [showWallet, setShowWallet] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShowWallet(isMobileSurface());
    setPhase('idle');
    let active = true;
    void toDataUrl(cardPayload(token)).then((url) => {
      if (active) setQr(url);
    });
    return () => {
      active = false;
    };
  }, [open, token]);

  async function onAddToWallet() {
    setPhase('working');
    try {
      const pass = await wallet.ensurePass(customerId);
      const url = detectWalletKind() === 'apple' ? pass.appleUrl : pass.googleUrl;
      window.open(url, '_blank', 'noopener');
      setPhase('idle');
    } catch {
      setPhase('error');
    }
  }

  const walletLabel = detectWalletKind() === 'apple' ? 'Add to Apple Wallet' : 'Save to Google Wallet';
  const shortCode = token.slice(0, 6).toUpperCase();

  return (
    <Overlay open={open} onClose={onClose} tone="white" label="Your card code, enlarged">
      <div className="enlarged-qr">
        <div className="enlarged-qr__code">
          {qr ? (
            <img src={qr} alt="Your card code" className="enlarged-qr__img" />
          ) : (
            <div className="enlarged-qr__placeholder" aria-hidden="true" />
          )}
        </div>

        <p className="enlarged-qr__name">{name}</p>
        <Eyebrow>{shortCode}</Eyebrow>

        {showWallet && (
          <div className="enlarged-qr__wallet">
            <Button
              variant="wallet"
              size="lg"
              leading="◰"
              onClick={onAddToWallet}
              disabled={phase === 'working'}
            >
              {phase === 'working' ? 'Preparing your pass…' : walletLabel}
            </Button>
            {phase === 'error' && (
              <p className="screen__error" role="alert">
                Couldn’t prepare your pass. Try again.
              </p>
            )}
            <p className="enlarged-qr__caveat">
              The wallet pass is a snapshot — this card stays the place to watch your cups fill.
            </p>
          </div>
        )}
      </div>
    </Overlay>
  );
}

export default EnlargedQrOverlay;
