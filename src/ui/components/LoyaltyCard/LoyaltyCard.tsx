/**
 * LoyaltyCard — the forest-gradient membership card (reference views 04 & 05).
 *
 * The centerpiece of the customer surface. Composes the shared CupStamps and Qr.
 * Two states driven by whether the customer owns any unspent reward:
 *   - collecting → a progress note ("{remaining} more for a free coffee" · {filled}/{total})
 *   - reward     → a sage reward entry replaces the note; the screen background
 *                  (owned by the screen) shifts blush → sage.
 *
 * Rewards-as-objects (REWARDS-PLAN Phase 6): the card reads the discrete unspent
 * `rewards` (not a boolean). Tapping the entry shows the FIRST reward's QR; when
 * 2+ are owned a count badge appears — tapping it expands a selectable list
 * (first preselected) and the badge becomes a QR icon that composes the selected
 * rewards into one reward QR. The chosen reward tokens are handed up via
 * `onRedeem(rewardTokens)`; the screen renders the actual QR overlay.
 *
 * Presentation only: selection/expansion is local view state; the card never
 * reads or writes services. The "⋯" (onMenu) and the QR tap (onEnlarge) are
 * surfaced as callbacks.
 */
import { useEffect, useState } from 'react';
import type { Reward } from '../../../domain/models';
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
  /** Unspent rewards the customer owns. Length drives the reward entry + badge:
   *  ≥1 shows the entry, 2+ shows a count badge with the composite picker. */
  rewards?: Reward[];
  /** Tap the QR → enlarged overlay. */
  onEnlarge?: () => void;
  /** Show a reward QR for the given reward tokens (single tap = first reward;
   *  composite = the selected subset). */
  onRedeem?: (rewardTokens: string[]) => void;
  /** Tap the "⋯" → card menu. */
  onMenu?: () => void;
}

const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l2.4 6.3L21 9l-5 4.2L17.6 20 12 16.4 6.4 20 8 13.2 3 9l6.6-.7z" />
  </svg>
);

const CupIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
    <path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16" />
  </svg>
);

const QrIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 3h7v7H3V3zm2 2v3h3V5H5zm9-2h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zm9 0h2v2h-2v-2zm3-2h2v2h-2v-2zm2 2h2v2h-2v-2zm-5 3h2v2h-2v-2zm3 0h2v2h-2v-2z" />
  </svg>
);

export function LoyaltyCard({
  name,
  filled,
  total,
  token,
  code,
  rewards = [],
  onEnlarge,
  onRedeem,
  onMenu,
}: LoyaltyCardProps) {
  const remaining = Math.max(total - filled, 0);
  const count = rewards.length;
  const rewardReady = count > 0;

  // Local picker state: which rewards are queued for a composite redeem, and
  // whether the list is expanded. Reset whenever the owned reward set changes.
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const rewardKey = rewards.map((r) => r.id).join(',');
  useEffect(() => {
    setExpanded(false);
    setSelected(rewards.length ? { [rewards[0].id]: true } : {});
    // rewardKey captures the identity of the owned set; depend on it only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardKey]);

  const selectedTokens = rewards.filter((r) => selected[r.id]).map((r) => r.token);

  const toggle = (id: string) =>
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  // Tap the entry → the first reward's QR (a single reward is a 1-element composite).
  const redeemFirst = () => onRedeem?.(rewards.slice(0, 1).map((r) => r.token));

  // Tap the badge → expand the picker; once expanded the badge is a QR icon that
  // composes the selected rewards into one reward QR.
  const onBadge = () => {
    if (!expanded) {
      setExpanded(true);
      return;
    }
    if (selectedTokens.length > 0) onRedeem?.(selectedTokens);
  };

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
            <button
              type="button"
              className="ready-entry"
              onClick={redeemFirst}
              aria-label="Show your free coffee code"
            >
              <StarIcon />
              <div>
                <div className="b1">
                  Free coffee unlocked
                  {expanded && selectedTokens.length > 1 && (
                    <span className="mult">×{selectedTokens.length}</span>
                  )}
                </div>
                <div className="b2">Show this at the counter to redeem</div>
              </div>
            </button>
            {count >= 2 && (
              <button
                type="button"
                className="ready-badge"
                onClick={onBadge}
                aria-label={
                  expanded
                    ? `Show a code for ${selectedTokens.length} free coffees`
                    : `${count} free coffees unlocked — choose how many to redeem`
                }
              >
                {expanded ? (
                  <QrIcon />
                ) : (
                  <>
                    <CupIcon />
                    <b>{count}</b>
                  </>
                )}
              </button>
            )}
          </div>
          {expanded && count >= 2 && (
            <ul className="reward-choices">
              {rewards.map((reward) => (
                <li key={reward.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!selected[reward.id]}
                      onChange={() => toggle(reward.id)}
                    />
                    <span>{reward.descriptionSnapshot}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="progress-note">
          <div className="left">
            <b>{remaining} more</b> for a free coffee
          </div>
          {/* The card shows a fixed 10-stamp grid (earnable cups + the free
              reward cup, shown pre-stamped), so the counter reflects the
              displayed cups, not the raw threshold. */}
          <div className="pts">
            {filled + 1} / {total + 1}
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
