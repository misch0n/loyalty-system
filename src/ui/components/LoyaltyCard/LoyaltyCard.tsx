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
  /** Number of free coffees currently unlocked (floor(balance / threshold)). A
   *  count of 2+ shows a badge on the unlocked banner; 1 shows none. */
  rewardsAvailable?: number;
  /** Tap the QR → enlarged overlay. */
  onEnlarge?: () => void;
  /** Tap the unlocked-reward banner → special "redeem" overlay. */
  onRedeem?: () => void;
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
  rewardsAvailable = 0,
  onEnlarge,
  onRedeem,
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
          <button
            type="button"
            className="ready-banner"
            onClick={onRedeem}
            aria-label="Redeem your free coffee"
          >
            <span className="spark" />
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.4 6.3L21 9l-5 4.2L17.6 20 12 16.4 6.4 20 8 13.2 3 9l6.6-.7z" />
            </svg>
            <div>
              <div className="b1">Free coffee unlocked</div>
              <div className="b2">Show this at the counter to redeem</div>
            </div>
            {rewardsAvailable >= 2 && (
              <span className="ready-badge" aria-label={`${rewardsAvailable} free coffees unlocked`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
                  <path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16" />
                </svg>
                <b>{rewardsAvailable}</b>
              </span>
            )}
          </button>
        </>
      ) : (
        <div className="progress-note">
          <div className="left">
            <b>{remaining} more</b> for a free coffee
          </div>
          {/* The card shows a fixed 10-stamp grid (welcome + earnable + free,
              both freebies pre-stamped), so the counter reflects the displayed
              cups, not the raw threshold. */}
          <div className="pts">
            {filled + 2} / {total + 2}
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
