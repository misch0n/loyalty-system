/**
 * Small pill primitives: TierPill (membership tier) and StatusPill (state).
 * Both are presentational; consumers pass the label and pick a tone.
 */
import type { ReactNode } from 'react';

export type PillTone = 'sage' | 'blush' | 'forest' | 'terra' | 'neutral';

export interface TierPillProps {
  children: ReactNode;
  /** Visual tone. Defaults to sage (the member tier accent). */
  tone?: PillTone;
  className?: string;
}

export function TierPill({ children, tone = 'sage', className }: TierPillProps) {
  const cls = ['kit-pill', 'kit-pill--tier', `kit-pill--${tone}`, className]
    .filter(Boolean)
    .join(' ');
  return <span className={cls}>{children}</span>;
}

export interface StatusPillProps {
  children: ReactNode;
  /** Semantic status -> tone mapping handled by consumer. */
  tone?: PillTone;
  /** Optional leading dot indicator. */
  dot?: boolean;
  className?: string;
}

export function StatusPill({ children, tone = 'neutral', dot = false, className }: StatusPillProps) {
  const cls = ['kit-pill', 'kit-pill--status', `kit-pill--${tone}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls}>
      {dot && <span className="kit-pill__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
