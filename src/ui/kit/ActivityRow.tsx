/**
 * ActivityRow — one line of the admin activity log (UI-SPEC §4.10).
 *
 * Reads as "Sam · added a coffee · Maria · 2m". Backed by the ledger; this
 * component is purely presentational and takes already-formatted parts.
 */
import type { ReactNode } from 'react';

export interface ActivityRowProps {
  /** Staff name who performed the action. */
  actor: ReactNode;
  /** What happened (e.g. "added a coffee", "redeemed a reward"). */
  action: ReactNode;
  /** Affected customer name, if any. */
  target?: ReactNode;
  /** Relative time (e.g. "2m"). */
  time: ReactNode;
  /** Optional leading icon/glyph. */
  icon?: ReactNode;
  className?: string;
}

export function ActivityRow({ actor, action, target, time, icon, className }: ActivityRowProps) {
  const cls = ['kit-activity', className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {icon != null && (
        <span className="kit-activity__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="kit-activity__text">
        <span className="kit-activity__actor">{actor}</span>
        <span className="kit-activity__sep" aria-hidden="true">
          ·
        </span>
        <span className="kit-activity__action">{action}</span>
        {target != null && (
          <>
            <span className="kit-activity__sep" aria-hidden="true">
              ·
            </span>
            <span className="kit-activity__target">{target}</span>
          </>
        )}
      </span>
      <time className="kit-activity__time">{time}</time>
    </div>
  );
}
