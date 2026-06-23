/**
 * PinPad — numeric PIN entry for staff/admin login (UI-SPEC §3, §4.7).
 *
 * Controlled: `value` is the digit string, `onChange` receives the next value.
 * Renders a masked display, a 0–9 grid with a delete key, an error line slot,
 * and a "remember this device" toggle slot. Pure presentation — the screen
 * decides what a complete PIN means and when to submit.
 */
import type { ReactNode } from 'react';

export interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  /** Expected length; drives the masked dots. Defaults to 4. */
  length?: number;
  /** Error line content (instructive copy on wrong PIN). */
  error?: ReactNode;
  /** Slot for the "remember this device" toggle. */
  rememberSlot?: ReactNode;
  /** Disable all keys (e.g. while verifying). */
  disabled?: boolean;
  className?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function PinPad({
  value,
  onChange,
  length = 4,
  error,
  rememberSlot,
  disabled = false,
  className,
}: PinPadProps) {
  const cls = ['kit-pinpad', disabled ? 'kit-pinpad--disabled' : '', className]
    .filter(Boolean)
    .join(' ');

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
    <div className={cls}>
      <div className="kit-pinpad__display" role="status" aria-label={`${value.length} of ${length} digits entered`}>
        {dots.map((on, i) => (
          <span key={i} className={`kit-pinpad__dot ${on ? 'kit-pinpad__dot--on' : ''}`} aria-hidden="true" />
        ))}
      </div>
      {error != null && (
        <p className="kit-pinpad__error" role="alert">
          {error}
        </p>
      )}
      <div className="kit-pinpad__grid">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="kit-pinpad__key"
            disabled={disabled}
            onClick={() => press(k)}
          >
            {k}
          </button>
        ))}
        <span className="kit-pinpad__key kit-pinpad__key--empty" aria-hidden="true" />
        <button
          type="button"
          className="kit-pinpad__key"
          disabled={disabled}
          onClick={() => press('0')}
        >
          0
        </button>
        <button
          type="button"
          className="kit-pinpad__key kit-pinpad__key--del"
          disabled={disabled}
          onClick={del}
          aria-label="Delete"
        >
          ⌫
        </button>
      </div>
      {rememberSlot != null && <div className="kit-pinpad__remember">{rememberSlot}</div>}
    </div>
  );
}
