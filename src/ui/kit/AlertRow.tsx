/**
 * AlertRow — one suspicious-activity flag in admin (UI-SPEC §4.10).
 *
 * Shows the trigger, the staff name, and the device. Monitoring, not blocking —
 * styling signals attention without alarm. Purely presentational.
 */
import type { ReactNode } from 'react';

export type AlertSeverity = 'low' | 'medium' | 'high';

export interface AlertRowProps {
  /** Why this was flagged (e.g. "Oversized multi-add"). */
  trigger: ReactNode;
  /** Staff name attached to the action. */
  staff: ReactNode;
  /** Device label the action came from. */
  device: ReactNode;
  /** Relative time. */
  time?: ReactNode;
  /** Severity tint. Defaults to medium. */
  severity?: AlertSeverity;
  className?: string;
}

export function AlertRow({
  trigger,
  staff,
  device,
  time,
  severity = 'medium',
  className,
}: AlertRowProps) {
  const cls = ['kit-alert', `kit-alert--${severity}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} data-severity={severity}>
      <span className="kit-alert__flag" aria-hidden="true" />
      <div className="kit-alert__body">
        <span className="kit-alert__trigger">{trigger}</span>
        <span className="kit-alert__meta">
          {staff}
          <span className="kit-alert__sep" aria-hidden="true">
            ·
          </span>
          {device}
          {time != null && (
            <>
              <span className="kit-alert__sep" aria-hidden="true">
                ·
              </span>
              {time}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
