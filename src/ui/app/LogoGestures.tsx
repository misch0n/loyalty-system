/**
 * Logo gestures (UX-SPEC §2 + the user's split-tap model).
 *
 * In the Ckyka reference each screen renders its own logo (Welcome hero, staff
 * topbar, a discreet mark on the customer header) — there is NO global chrome and
 * NO "Staff sign-in" subtitle. So the gesture behaviour lives in a small context
 * + a `<GestureLogo>` wrapper that any screen can put around its logo:
 *
 *   - tap LEFT half   → onHome  (home: '/' → entry resolver → welcome/card/staff)
 *   - tap RIGHT half  → onTools (prototype tools panel; prototype build only)
 *   - long-press ≥600ms → onHold (staff/admin sign-in)
 *
 * App supplies the handlers once via `LogoGesturesProvider`; screens stay
 * presentational. A visually-hidden, always-focusable "Staff sign-in" button
 * gives a guaranteed keyboard path to onHold (the long-press is pointer-only).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import './logo-gestures.css';

const HOLD_MS = 600;

/** Which half of the logo a tap landed in (left = home, right = tools). */
export function tapSide(clientX: number, rect: { left: number; width: number }): 'left' | 'right' {
  return clientX - rect.left >= rect.width / 2 ? 'right' : 'left';
}

export interface LogoHandlers {
  onHome?: () => void;
  onTools?: () => void;
  onHold?: () => void;
}

const LogoGesturesContext = createContext<LogoHandlers>({});

export function LogoGesturesProvider({
  value,
  children,
}: {
  value: LogoHandlers;
  children: ReactNode;
}): JSX.Element {
  return <LogoGesturesContext.Provider value={value}>{children}</LogoGesturesContext.Provider>;
}

export function useLogoGestures(): LogoHandlers {
  return useContext(LogoGesturesContext);
}

/**
 * Wrap a logo with the tap-half / long-press gestures. The child is whatever the
 * screen wants to show (a Lockup, a LogoMark, the topbar brand…).
 */
export function GestureLogo({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const { onHome, onTools, onHold } = useLogoGestures();

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
      onHold?.();
    }, HOLD_MS);
  }, [clearTimer, onHold]);

  const endPress = useCallback(
    (side: 'left' | 'right') => {
      if (!pressingRef.current) return;
      pressingRef.current = false;
      clearTimer();
      if (heldRef.current) return; // a completed hold already fired
      if (side === 'right' && onTools) onTools();
      else onHome?.();
    },
    [clearTimer, onTools, onHome],
  );

  const cancelPress = useCallback(() => {
    pressingRef.current = false;
    clearTimer();
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      endPress(tapSide(e.clientX, rect));
    },
    [endPress],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (!pressingRef.current) beginPress();
    },
    [beginPress],
  );

  const onKeyUp = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      endPress('left'); // a keyboard has no left/right half — tap goes home
    },
    [endPress],
  );

  return (
    <span className={['logo-gesture-wrap', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="logo-gesture"
        aria-label="Ckyka Rewards — tap for home, hold for staff sign-in"
        onPointerDown={beginPress}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelPress}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onClick={(e) => e.preventDefault()}
      >
        {children}
      </button>
      {onHold ? (
        <button type="button" className="logo-staff-link sr-only" onClick={() => onHold()}>
          Staff sign-in
        </button>
      ) : null}
    </span>
  );
}
