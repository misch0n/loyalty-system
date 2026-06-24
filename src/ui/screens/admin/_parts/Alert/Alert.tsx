/**
 * Alert — a "Needs a look" suspicious-activity card (reference 11).
 *
 * Donor markup: a ⚠️ glyph, a title/detail pair (`.at`/`.as`), and a trailing
 * mono age (`.ag`). Monitoring only — these flag patterns for review, they never
 * block. Pure presentation; the screen derives the content from
 * `loyalty.getAlerts()`.
 */
import type { ReactNode } from 'react';
import './Alert.css';

export interface AlertProps {
  title: ReactNode;
  detail: ReactNode;
  /** Relative age, e.g. "9m". */
  time: ReactNode;
  /** When set, the card becomes a button that opens its detail popover. */
  onClick?: () => void;
}

export function Alert({ title, detail, time, onClick }: AlertProps) {
  const inner = (
    <>
      <span style={{ fontSize: 16 }} aria-hidden="true">
        ⚠️
      </span>
      <div>
        <div className="at">{title}</div>
        <div className="as">{detail}</div>
      </div>
      <span className="ag">{time}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="alert alert-btn" onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className="alert">{inner}</div>;
}
