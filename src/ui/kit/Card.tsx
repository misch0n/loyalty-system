/**
 * Card — the forest-gradient member card surface (UI-SPEC §3, §4.4).
 *
 * Top row slot (member name in Fraunces + a tier pill on the right), a body
 * slot for children (cup stamps, progress note, QR tile), and a `reward`
 * variant that swaps in a sage background with a shimmering reward banner.
 *
 * Pure presentation. Screens pass the name, tier, and body content.
 */
import type { ReactNode } from 'react';

export interface CardProps {
  /** Member name, rendered in Fraunces in the top row. */
  name: ReactNode;
  /** Tier pill content (e.g. a <TierPill>) shown at the top-right. */
  tier?: ReactNode;
  /** Card body: cup stamps, progress note, QR tile, etc. */
  children: ReactNode;
  /** 'collecting' (forest) or 'reward' (sage + shimmer banner). */
  variant?: 'collecting' | 'reward';
  /** Banner copy for the reward variant. */
  rewardBanner?: ReactNode;
  className?: string;
}

export function Card({
  name,
  tier,
  children,
  variant = 'collecting',
  rewardBanner = 'Reward ready',
  className,
}: CardProps) {
  const cls = ['kit-card', `kit-card--${variant}`, className].filter(Boolean).join(' ');
  return (
    <section className={cls} data-variant={variant}>
      {variant === 'reward' && (
        <div className="kit-card__banner" role="status">
          <span className="kit-card__banner-shimmer" aria-hidden="true" />
          <span className="kit-card__banner-label">{rewardBanner}</span>
        </div>
      )}
      <header className="kit-card__top">
        <h2 className="kit-card__name">{name}</h2>
        {tier != null && <div className="kit-card__tier">{tier}</div>}
      </header>
      <div className="kit-card__body">{children}</div>
    </section>
  );
}
