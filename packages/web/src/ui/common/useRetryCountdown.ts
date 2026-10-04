/**
 * The disabled-button countdown a `rate_limited` refusal asks for (X2).
 *
 * `start(seconds)` begins (or restarts) the wait; `secondsLeft` counts down to
 * 0 once a second, and `waiting` is true until it gets there. A screen disables
 * its button while `waiting` and labels it with {@link formatWait}, so the
 * person sees exactly when they can try again instead of a frozen "a few
 * minutes". The timer is cleared on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RetryCountdown {
  secondsLeft: number;
  waiting: boolean;
  start(seconds: number): void;
}

export function useRetryCountdown(): RetryCountdown {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const deadline = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(
    (seconds: number) => {
      stop();
      const whole = Math.max(0, Math.ceil(seconds));
      if (whole === 0) {
        setSecondsLeft(0);
        return;
      }
      deadline.current = Date.now() + whole * 1000;
      setSecondsLeft(whole);
      timer.current = setInterval(() => {
        const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left === 0) stop();
      }, 250);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { secondsLeft, waiting: secondsLeft > 0, start };
}

/** "45 s", "2:05" — short enough for a button label. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
