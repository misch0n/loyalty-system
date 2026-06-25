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
import { BotanicalWreath } from '../../../components/BotanicalWreath/BotanicalWreath';
import { useServices } from '../../../common/ServicesContext';
import { cardPayload, rewardScanPayload, toDataUrl } from '../../../../qr/encode';
import { detectWalletKind } from '../../../../wallet/passes';
import './EnlargedQr.css';

export interface EnlargedQrProps {
  open: boolean;
  onClose: () => void;
  /** Internal customer id — used to ensure/mint the wallet pass. */
  customerId: string;
  /** Opaque card token — drives the card QR payload (and the `c=` of a reward QR). */
  token: string;
  /** Member display name, or a neutral fallback. */
  name: string;
  /** Short human code shown under the name, e.g. "CKY · 5YUrTHtx". */
  code: string;
  /** Special "redeem your free coffee" presentation: the REWARD QR (not the card
   *  QR), framed by the café's botanical artwork; no wallet button. */
  redeem?: boolean;
  /** Reward tokens to encode in the redeem QR (`/r?ids=…&c=<token>`). One token =
   *  a single reward; 2+ = a composite. Ignored unless `redeem` is set. */
  rewardTokens?: string[];
}

type WalletPhase = 'idle' | 'error';

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

export function EnlargedQr({
  open,
  onClose,
  customerId,
  token,
  name,
  code,
  redeem = false,
  rewardTokens = [],
}: EnlargedQrProps) {
  const { wallet } = useServices();
  const [qr, setQr] = useState<string | null>(null);
  const [phase, setPhase] = useState<WalletPhase>('idle');
  const [showWallet, setShowWallet] = useState(false);
  // Pre-resolved pass URL for the current OS. Computed when the overlay opens so
  // the button's click handler can open the window SYNCHRONOUSLY — opening it
  // after an `await` loses the user-gesture context and pop-up blockers eat it
  // (that was why "Add to wallet" appeared to do nothing).
  const [passUrl, setPassUrl] = useState<string | null>(null);

  const os = detectWalletKind();
  // In redeem mode the QR carries the reward token(s) (`/r?ids=…&c=<token>`); the
  // plain enlarged view carries the card URL. A redeem QR with no reward tokens
  // falls back to the card QR (defensive — should not happen).
  const rewardKey = rewardTokens.join(',');

  useEffect(() => {
    if (!open) return;
    setShowWallet(!redeem && isMobileSurface());
    setPhase('idle');
    setPassUrl(null);
    let active = true;
    const payload =
      redeem && rewardTokens.length > 0
        ? rewardScanPayload(rewardTokens, token)
        : cardPayload(token);
    void toDataUrl(payload).then((url) => {
      if (active) setQr(url);
    });
    // Resolve the wallet pass up front (the static provider is a cheap local
    // lookup) so tapping the button is a synchronous window.open. Skipped in
    // redeem mode, which never shows the wallet button.
    if (!redeem) {
      void wallet
        .ensurePass(customerId)
        .then((pass) => {
          if (!active) return;
          setPassUrl(os === 'apple' ? pass.appleUrl : pass.googleUrl);
        })
        .catch(() => {
          if (active) setPhase('error');
        });
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, customerId, wallet, os, redeem, rewardKey]);

  function onAddToWallet() {
    if (!passUrl) {
      setPhase('error');
      return;
    }
    window.open(passUrl, '_blank', 'noopener');
  }

  const qrImg = qr ? (
    <img className="enlarged-qr-img" src={qr} alt="Your card code" />
  ) : (
    <div className="enlarged-qr-img enlarged-qr-placeholder" aria-hidden="true" />
  );

  if (redeem) {
    // Special redeem presentation: the REWARD QR, framed by the café's botanical
    // artwork (leaves, beans, coffee cherries) so claiming a free coffee feels
    // like an event. A composite (2+ rewards) reads in the plural.
    const many = rewardTokens.length > 1;
    return (
      <Overlay open={open} onClose={onClose} label="Redeem your free coffee">
        <div className="redeem-panel">
          <BotanicalWreath className="redeem-deco" />
          <div className="redeem-inner">
            <h2 className="redeem-title">{many ? 'Your free coffees' : 'Your free coffee'}</h2>
            <p className="redeem-sub">
              {many
                ? 'Show this at the counter to redeem them all.'
                : 'Show this at the counter to redeem.'}
            </p>
            <div className="redeem-qrbox">{qrImg}</div>
            <div className="cd redeem-cd">{code}</div>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay open={open} onClose={onClose} label="Your card code, enlarged">
      <div className="enlarged-qr-box">{qrImg}</div>
      <div className="nm">{name}</div>
      <div className="cd">{code}</div>

      {showWallet && (
        <div
          className="enlarged-qr-wallet-slot"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <WalletButton os={os} onClick={onAddToWallet} disabled={!passUrl && phase !== 'error'} />
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
