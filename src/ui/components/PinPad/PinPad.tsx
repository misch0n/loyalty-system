/**
 * PinPad — numeric PIN entry for staff/admin sign-in (Ckyka view 08).
 *
 * Controlled: `value` is the digit string, `onChange` receives the next value.
 * Donor markup: a `.pin-dots` row above (first `value.length` dots get `.on`),
 * then a `.keypad` 3-col grid of `.key`s — 1–9, a `.key.blank` spacer, 0, and a
 * delete key carrying the donor backspace svg. Pure presentation; the screen
 * decides what a complete PIN means and when to submit. Press/del logic reused
 * from the old kit.
 */
import type { ReactNode } from 'react';
import './PinPad.css';

export interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  /** Expected length; drives the dots. Defaults to 4. */
  length?: number;
  /** Disable all keys (e.g. while verifying). */
  disabled?: boolean;
  /** Slot for the "remember this device" toggle, rendered in `.remember-row`. */
  rememberSlot?: ReactNode;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const DeleteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M9 6h11v12H9L3 12z" strokeLinejoin="round" />
    <path d="M13 10l4 4M17 10l-4 4" strokeLinecap="round" />
  </svg>
);

export function PinPad({ value, onChange, length = 4, disabled = false, rememberSlot }: PinPadProps) {
  const press = (digit: string) => {
    if (disabled || value.length >= length) return;
    onChange(value + digit);
  };
  const del = () => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  const dots = Array.from({ length }, (_, i) => i < value.length);

  return (
    <>
      <div
        className="pin-dots"
        role="status"
        aria-label={`${value.length} of ${length} digits entered`}
      >
        {dots.map((on, i) => (
          <i key={i} className={on ? 'on' : undefined} aria-hidden="true" />
        ))}
      </div>

      <div className="keypad">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="key"
            data-k={k}
            disabled={disabled}
            onClick={() => press(k)}
          >
            {k}
          </button>
        ))}
        <span className="key blank" aria-hidden="true" />
        <button type="button" className="key" data-k="0" disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="key"
          data-k="del"
          aria-label="Delete"
          disabled={disabled}
          onClick={del}
        >
          <DeleteIcon />
        </button>
      </div>

      {rememberSlot != null && <div className="remember-row">{rememberSlot}</div>}
    </>
  );
}
