/**
 * LoyaltyCard — the forest-gradient membership card (reference views 04 & 05).
 *
 * The centerpiece of the customer surface. Composes the shared CupStamps and Qr.
 * Two states driven by `rewardReady`:
 *   - collecting → a progress note ("{remaining} more for a free coffee" · {filled}/{total})
 *   - reward     → the sage ready-banner replaces the note; the screen background
 *                  (owned by the screen) shifts blush → sage.
 *
 * Pure presentation. The "⋯" (onMenu) and the QR tap (onEnlarge) are surfaced as
 * callbacks; the card itself reads/writes nothing.
 */
import { CupStamps } from '../CupStamps/CupStamps';
import { Qr } from '../Qr/Qr';
import './LoyaltyCard.css';

export interface LoyaltyCardProps {
  /** Display name; the screen passes "Your card" for anonymous customers. */
  name: string;
  /** Earned stamps (derived balance toward the next reward). */
  filled: number;
  /** Reward threshold (total cups). */
  total: number;
  /** Opaque card token — encoded into the QR's card URL (never PII). */
  token: string;
  /** Short human code shown beside the QR, e.g. "CKY · 5YUrTHtx". */
  code: string;
  /** Reward-ready state (derived balance ≥ threshold). */
  rewardReady?: boolean;
  /** Tap the QR → enlarged overlay. */
  onEnlarge?: () => void;
  /** Tap the "⋯" → card menu. */
  onMenu?: () => void;
}

export function LoyaltyCard({
  name,
  filled,
  total,
  token,
  code,
  rewardReady = false,
  onEnlarge,
  onMenu,
}: LoyaltyCardProps) {
  const remaining = Math.max(total - filled, 0);

  return (
    <div className="card">
      <div className="glaze" />

      {onMenu && (
        <button type="button" className="dots-btn" aria-label="Card options" onClick={onMenu}>
          ···
        </button>
      )}

      <div className="card-top">
        <div>
          <div className="who">{name}</div>
          <p className="pname">member · ckyka rewards</p>
        </div>
      </div>

      <CupStamps filled={filled} total={total} showcase />

      {rewardReady ? (
        <>
          <div style={{ height: 14 }} />
          <div className="ready-banner">
            <span className="spark" />
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.4 6.3L21 9l-5 4.2L17.6 20 12 16.4 6.4 20 8 13.2 3 9l6.6-.7z" />
            </svg>
            <div>
              <div className="b1">Free coffee unlocked</div>
              <div className="b2">Show this at the counter to redeem</div>
            </div>
          </div>
        </>
      ) : (
        <div className="progress-note">
          <div className="left">
            <b>{remaining} more</b> for a free coffee
          </div>
          {/* The card shows a 10-cup grid (welcome + earnable + free), so the
              counter reflects the displayed cups, not the raw threshold. */}
          <div className="pts">
            {filled + 1} / {total + 2}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <Qr token={token} code={code} onEnlarge={onEnlarge} />
      </div>
    </div>
  );
}

export default LoyaltyCard;
