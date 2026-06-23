/**
 * HoldButton — a destructive-action button that fires only after a deliberate
 * press-and-hold, with an expanding fill that turns solid red from centre to
 * edges over the hold duration. Text selection is disabled within its bounds.
 *
 * `holdMs={0}` (the default) degrades to a plain single-tap button — used for
 * lower-stakes confirmations (e.g. removing a recoverable card from a device).
 * `holdMs={3000}` is the "hold if you're certain" gate for unrecoverable
 * actions (token-only removal, card deletion). Pointer AND keyboard (Enter/Space)
 * both require the full hold.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import './HoldButton.css';

export interface HoldButtonProps {
  onConfirm: () => void;
  /** Hold duration in ms. 0 = single tap. */
  holdMs?: number;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function HoldButton({
  onConfirm,
  holdMs = 0,
  children,
  className,
  disabled,
}: HoldButtonProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pressingRef = useRef(false);

  const cancel = useCallback(() => {
    pressingRef.current = false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setArmed(false);
  }, []);

  const begin = useCallback(() => {
    if (disabled || pressingRef.current) return;
    pressingRef.current = true;
    setArmed(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pressingRef.current = false;
      setArmed(false);
      onConfirm();
    }, holdMs);
  }, [disabled, holdMs, onConfirm]);

  // Clean up a pending timer if we unmount mid-hold.
  useEffect(() => () => cancel(), [cancel]);

  if (holdMs <= 0) {
    return (
      <button
        type="button"
        className={['hold-btn', 'tap', className].filter(Boolean).join(' ')}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onConfirm();
        }}
      >
        <span className="hold-label">{children}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={['hold-btn', 'hold', armed ? 'is-armed' : '', className].filter(Boolean).join(' ')}
      disabled={disabled}
      style={{ '--hold-ms': `${holdMs}ms` } as CSSProperties}
      onPointerDown={(e) => {
        e.preventDefault();
        begin();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cancel();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-label">{children}</span>
    </button>
  );
}

export default HoldButton;
