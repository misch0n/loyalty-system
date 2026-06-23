/**
 * Banner — an inline, persistent notice (UI-SPEC §3).
 *
 * Used for quiet contextual states: offline, session expiring, "viewing a
 * friend's card". Distinct from Toast (which is transient). Purely
 * presentational; the screen controls visibility.
 */
import type { ReactNode } from 'react';

export type BannerTone = 'info' | 'offline' | 'warning' | 'success';

export interface BannerProps {
  children: ReactNode;
  /** Visual tone / semantics. Defaults to info. */
  tone?: BannerTone;
  /** Optional leading icon/glyph. */
  icon?: ReactNode;
  /** Optional trailing action (e.g. a ghost button). */
  action?: ReactNode;
  /** Optional dismiss handler; shows a close affordance when provided. */
  onDismiss?: () => void;
  className?: string;
}

export function Banner({ children, tone = 'info', icon, action, onDismiss, className }: BannerProps) {
  const cls = ['kit-banner', `kit-banner--${tone}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} role="status" data-tone={tone}>
      {icon != null && (
        <span className="kit-banner__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="kit-banner__text">{children}</span>
      {action != null && <span className="kit-banner__action">{action}</span>}
      {onDismiss && (
        <button type="button" className="kit-banner__close" aria-label="Dismiss" onClick={onDismiss}>
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
