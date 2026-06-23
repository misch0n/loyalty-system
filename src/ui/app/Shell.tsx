/**
 * App shell (UI-SPEC §2).
 *
 * Full-screen, mobile-first, centered content column with a sane max width on
 * larger screens and safe-area insets. No persistent nav bar — navigation is
 * contextual (the card is the hub).
 *
 * Logo gestures (global, on the brand mark):
 *   - tap LEFT half   → onLogoHome  (home: '/' → entry resolver → welcome/card/staff)
 *   - tap RIGHT half  → onLogoTools (prototype tools panel; prototype build only)
 *   - long-press ≥600ms → onLogoHold (staff/admin login)
 *
 * The left/right split is by the tap's horizontal position within the logo
 * button (see `tapSide`). When `onLogoTools` is omitted (production build), a
 * right-half tap falls back to home, so both halves go home.
 *
 * Keyboard accessibility (UI-SPEC §2 / §6 quality floor):
 *   1. The logo button: Enter/Space tap → home (the safe default; a keyboard has
 *      no left/right half). Held past the 600ms threshold (key auto-repeat) →
 *      onLogoHold, mirroring the pointer long-press.
 *   2. A small, always-reachable "Staff sign-in" control after the brand — a
 *      guaranteed, repeat-independent keyboard path to onLogoHold.
 * The prototype tools are a dev-only pointer gesture (no keyboard path by design;
 * they are excluded from production entirely).
 */

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import './shell.css';

const HOLD_MS = 600;

/** Which half of the logo a tap landed in (left = home, right = tools). */
export function tapSide(clientX: number, rect: { left: number; width: number }): 'left' | 'right' {
  return clientX - rect.left >= rect.width / 2 ? 'right' : 'left';
}

export interface ShellProps {
  children: ReactNode;
  /** Left-half tap (and keyboard tap) → home. */
  onLogoHome?: () => void;
  /** Right-half tap → prototype tools panel (prototype build only). */
  onLogoTools?: () => void;
  /** Logo long-press (≥600ms) → staff/admin login. */
  onLogoHold?: () => void;
}

export function Shell({ children, onLogoHome, onLogoTools, onLogoHold }: ShellProps): JSX.Element {
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

  const endPress = useCallback(
    (side: 'left' | 'right') => {
      if (!pressingRef.current) return;
      pressingRef.current = false;
      clearTimer();
      // A completed hold already fired; a short press is a tap.
      if (heldRef.current) return;
      // Right half opens the tools panel when available; everything else is home.
      if (side === 'right' && onLogoTools) onLogoTools();
      else onLogoHome?.();
    },
    [clearTimer, onLogoTools, onLogoHome],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      endPress(tapSide(e.clientX, rect));
    },
    [endPress],
  );

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
      // A keyboard has no left/right half — a tap goes home.
      endPress('left');
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
            aria-label="Ckyka Rewards — tap left for home, right for tools, hold for staff sign-in"
            onPointerDown={beginPress}
            onPointerUp={onPointerUp}
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
