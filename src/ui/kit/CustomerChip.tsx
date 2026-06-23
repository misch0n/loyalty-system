/**
 * CustomerChip — compact customer identity (UI-SPEC §3, §4.9).
 *
 * Avatar initial + name + "n of 10" progress + a status pill. Used in the staff
 * resolved state and the activity log. Pure presentation.
 */
import type { ReactNode } from 'react';
import { StatusPill, type PillTone } from './Pills';

export interface CustomerChipProps {
  /** Display name. The avatar initial is derived from it. */
  name: string;
  /** Filled cups for the "n of total" line. */
  filled: number;
  /** Reward threshold. Defaults to 10. */
  total?: number;
  /** Status pill content (e.g. "Reward ready", "Collecting"). */
  status?: ReactNode;
  /** Status pill tone. */
  statusTone?: PillTone;
  className?: string;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

export function CustomerChip({
  name,
  filled,
  total = 10,
  status,
  statusTone = 'sage',
  className,
}: CustomerChipProps) {
  const cls = ['kit-chip', className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="kit-chip__avatar" aria-hidden="true">
        {initialOf(name)}
      </span>
      <span className="kit-chip__meta">
        <span className="kit-chip__name">{name}</span>
        <span className="kit-chip__progress">
          {filled} of {total}
        </span>
      </span>
      {status != null && (
        <StatusPill tone={statusTone} className="kit-chip__status">
          {status}
        </StatusPill>
      )}
    </div>
  );
}
