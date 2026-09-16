/**
 * EnlargedQr — the full-surface enlarged QR (Ckyka reference view 06).
 *
 * Opened by tapping the QR on the card; Card owns the open state. A large,
 * high-contrast QR plus the member name and a short code (never PII).
 *
 * The wallet button is gone (UI-0): the `WalletProvider` port and both pass
 * adapters were deleted in the triage, so the web card is the only card.
 *
 * Rewards-as-objects (REWARDS-PLAN Phase 7): the redeem mode shows the composite
 * reward QR for the reward token(s) the card selected; the plain view shows the
 * card QR.
 */

import { useEffect, useState } from 'react';
import { Overlay } from '../../../components/Overlay/Overlay';
import { BotanicalWreath } from '../../../components/BotanicalWreath/BotanicalWreath';
import { cardPayload, rewardScanPayload, toDataUrl } from '../../../../qr/encode';
import './EnlargedQr.css';

export interface EnlargedQrProps {
  open: boolean;
  onClose: () => void;
  /** Opaque card token — drives the card QR payload (and the `c=` of a reward QR). */
  token: string;
  /** Member display name, or a neutral fallback. */
  name: string;
  /** Short human code shown under the name, e.g. "CKY · 5YUrTHtx". */
  code: string;
  /** Special "redeem your free coffee" presentation: the REWARD QR (not the card
   *  QR), framed by the café's botanical artwork. */
  redeem?: boolean;
  /** Reward tokens to encode in the redeem QR (`/r?ids=…&c=<token>`). One token =
   *  a single reward; 2+ = a composite. Ignored unless `redeem` is set. */
  rewardTokens?: string[];
}

export function EnlargedQr({
  open,
  onClose,
  token,
  name,
  code,
  redeem = false,
  rewardTokens = [],
}: EnlargedQrProps) {
  const [qr, setQr] = useState<string | null>(null);

  // In redeem mode the QR carries the reward token(s) (`/r?ids=…&c=<token>`); the
  // plain enlarged view carries the card URL. A redeem QR with no reward tokens
  // falls back to the card QR (defensive — should not happen).
  const rewardKey = rewardTokens.join(',');

  useEffect(() => {
    if (!open) return;
    let active = true;
    const payload =
      redeem && rewardTokens.length > 0
        ? rewardScanPayload(rewardTokens, token)
        : cardPayload(token);
    void toDataUrl(payload).then((url) => {
      if (active) setQr(url);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, redeem, rewardKey]);

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
    </Overlay>
  );
}

export default EnlargedQr;
