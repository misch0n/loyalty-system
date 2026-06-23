/**
 * App shell (UI-SPEC §2).
 *
 * Full-screen, mobile-first, centered content column with a sane max width on
 * larger screens and safe-area insets. No persistent nav bar — navigation is
 * contextual (the card is the hub).
 *
 * Logo gestures (global, on the brand mark):
 *   - tap            → onLogoTap   (prototype panel; caller no-ops in prod)
 *   - long-press ≥600ms → onLogoHold (staff/admin login)
 *
 * Keyboard accessibility (UI-SPEC §2 / §6 quality floor): the long-press is
 * mouse/touch-only, so we provide TWO keyboard paths to onLogoHold:
 *   1. The logo button itself: Enter/Space = tap; the same key held until the
 *      600ms threshold (key auto-repeat while held) fires hold. Releasing before
 *      the threshold fires tap. This mirrors the pointer gesture for keyboards
 *      that auto-repeat.
 *   2. A small, always-reachable "Staff sign-in" control rendered after the
 *      brand. It is not visually loud but is fully focusable and directly
 *      triggers onLogoHold — a guaranteed, repeat-independent keyboard path so
 *      staff entry is never gated behind a press-and-hold gesture.
 * Both paths are no-ops when the corresponding handler prop is omitted.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import './shell.css';

const HOLD_MS = 600;

export interface ShellProps {
  children: ReactNode;
  /** Logo tap → prototype panel (prototype build only; no-op in production). */
  onLogoTap?: () => void;
  /** Logo long-press (≥600ms) → staff/admin login. */
  onLogoHold?: () => void;
}

export function Shell({ children, onLogoTap, onLogoHold }: ShellProps): JSX.Element {
  // Tracks an in-flight press so we can distinguish tap from hold and avoid a
  // tap firing after a hold has already triggered.
  const holdTimer = useRef<number | null>(null);
  const heldRef = useRef(false);
  const pressingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const beginPress = useCallback(() => {
    pressingRef.current = true;
    heldRef.current = false;
    clearTimer();
    holdTimer.current = window.setTimeout(() => {
      heldRef.current = true;
      onLogoHold?.();
    }, HOLD_MS);
  }, [clearTimer, onLogoHold]);

  const endPress = useCallback(() => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    clearTimer();
    // A completed hold already fired; a short press is a tap.
    if (!heldRef.current) onLogoTap?.();
  }, [clearTimer, onLogoTap]);

  const cancelPress = useCallback(() => {
    pressingRef.current = false;
    clearTimer();
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      // First keydown begins the press; auto-repeat keydowns keep it alive until
      // the 600ms hold threshold fires onLogoHold.
      if (!pressingRef.current) beginPress();
    },
    [beginPress],
  );

  const onKeyUp = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      endPress();
    },
    [endPress],
  );

  return (
    <div className="shell safe-bottom">
      <div className="shell__content">
        <div className="shell__brand">
          <button
            type="button"
            className="shell__logo"
            aria-label="Ckyka Rewards — tap for tools, hold for staff sign-in"
            onPointerDown={beginPress}
            onPointerUp={endPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            // Suppress the browser's synthetic click; gestures are handled above.
            onClick={(e) => e.preventDefault()}
          >
            <span className="shell__logo-mark" aria-hidden="true" />
            <span>Ckyka</span>
          </button>
        </div>
        {/* Guaranteed keyboard path to staff sign-in (see file header). */}
        {onLogoHold ? (
          <button
            type="button"
            className="shell__staff-link"
            onClick={() => onLogoHold()}
          >
            Staff sign-in
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
