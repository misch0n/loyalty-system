/**
 * EnlargedQr — the full-surface enlarged QR + wallet button (Ckyka reference
 * view 06).
 *
 * Opened by tapping the QR on the card; Card owns the open state. A large,
 * high-contrast QR plus the member name and a short code (never PII). ONE
 * OS-aware wallet button, MOBILE ONLY — hidden on desktop, where the QR itself
 * is the "scan with your phone" path. On tap it mints/ensures the pass via
 * `wallet.ensurePass(customerId)` and opens the OS-appropriate URL.
 *
 * Liveness caveat (Free tier): the pass is a static snapshot, so the copy must
 * NOT imply it auto-updates — the web card stays the source of truth.
 */

import { useEffect, useState } from 'react';
import { Overlay } from '../../../components/Overlay/Overlay';
import { WalletButton } from '../../../components/Button/Button';
import { useServices } from '../../../common/ServicesContext';
import { cardPayload, toDataUrl } from '../../../../qr/encode';
import { detectWalletKind } from '../../../../wallet/passes';
import './EnlargedQr.css';

export interface EnlargedQrProps {
  open: boolean;
  onClose: () => void;
  /** Internal customer id — used to ensure/mint the wallet pass. */
  customerId: string;
  /** Opaque card token — drives the QR payload. */
  token: string;
  /** Member display name, or a neutral fallback. */
  name: string;
  /** Short human code shown under the name, e.g. "CKY · 5YUrTHtx". */
  code: string;
}

type WalletPhase = 'idle' | 'working' | 'error';

/**
 * Mobile heuristic for showing the wallet button: a touch device on a small-ish
 * viewport. Desktop (no touch / large viewport) gets the QR only.
 */
function isMobileSurface(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  const narrow = window.matchMedia?.('(max-width: 820px)').matches ?? false;
  return (coarse || touch) && narrow;
}

export function EnlargedQr({ open, onClose, customerId, token, name, code }: EnlargedQrProps) {
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

  const os = detectWalletKind();

  return (
    <Overlay open={open} onClose={onClose} label="Your card code, enlarged">
      {qr ? (
        <img className="enlarged-qr-img" src={qr} alt="Your card code" />
      ) : (
        <div className="enlarged-qr-img enlarged-qr-placeholder" aria-hidden="true" />
      )}
      <div className="nm">{name}</div>
      <div className="cd">{code}</div>

      {showWallet && (
        <div
          className="enlarged-qr-wallet-slot"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <WalletButton os={os} onClick={onAddToWallet} disabled={phase === 'working'} />
          {phase === 'error' && (
            <p className="enlarged-qr-error" role="alert">
              Couldn’t prepare your pass. Try again.
            </p>
          )}
          <p className="enlarged-qr-caveat">
            The wallet pass is a snapshot — this card stays the place to watch your cups fill.
          </p>
        </div>
      )}
    </Overlay>
  );
}

export default EnlargedQr;
