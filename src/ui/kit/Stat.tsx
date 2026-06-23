/**
 * StatCard — an admin "This week" figure (UI-SPEC §4.10).
 * The number is set in Fraunces numerals; the label sits beneath in DM Sans.
 */
import type { ReactNode } from 'react';

export interface StatCardProps {
  /** The figure (string or number) — rendered in Fraunces. */
  value: ReactNode;
  /** What the figure measures (e.g. "Coffees today"). */
  label: ReactNode;
  /** Optional secondary note (e.g. "+3 vs last week"). */
  note?: ReactNode;
  /** Accent tone for the card. */
  tone?: 'sage' | 'blush' | 'cream';
  className?: string;
}

export function StatCard({ value, label, note, tone = 'cream', className }: StatCardProps) {
  const cls = ['kit-stat', `kit-stat--${tone}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="kit-stat__value">{value}</span>
      <span className="kit-stat__label">{label}</span>
      {note != null && <span className="kit-stat__note">{note}</span>}
    </div>
  );
}
