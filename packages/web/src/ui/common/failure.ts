/**
 * What a screen says when a service call fails (`UI-RECONCILIATION.md` X2, S3).
 *
 * The classifier (`ApiError`) says *what* went wrong; {@link failureMessage}
 * turns that into one plain sentence for the point of action. Every screen
 * passes its own `fallback` — the sentence for "it didn't work" in its own
 * terms ("Couldn't save that change.") — and may override any kind whose
 * remedy is specific to it (a commit's offline copy has to say whether the
 * points landed; a generic one cannot).
 *
 * The defaults keep the two things a person needs apart: **can't reach** (their
 * connection — check it) versus **the server failed** (not them — wait). They
 * used to read the same, which sent people to fix a Wi-Fi that was fine.
 *
 * A `rate_limited` sentence never names a figure: the countdown is on the
 * button ({@link useRetryCountdown}), and a number frozen into the copy would
 * be wrong a second later.
 *
 * Only an {@link ApiError} is translated. Anything else gets the fallback — a
 * `TypeError` message is not something to show a customer.
 */

import { isApiError, type ApiFailureKind } from '../../services/errors';

export type FailureOverrides = Partial<Record<ApiFailureKind, string>>;

const DEFAULTS: Partial<Record<ApiFailureKind, string>> = {
  offline: 'Couldn’t reach the server. Check this device’s internet connection, then try again.',
  server: 'The server had a problem just now. Try again in a moment.',
  signed_out: 'You’ve been signed out. Sign in again, then try again.',
  rate_limited: 'Too many tries in a row. Wait for the countdown, then try again.',
};

/** 403 codes whose remedy is the same wherever they happen. */
const FORBIDDEN: Record<string, string> = {
  csrf_failed: 'This page is out of date. Reload it, then try again.',
  forbidden_origin: 'This page is out of date. Reload it, then try again.',
  staff_device: 'This device is signed in as a till. Use your own phone for this.',
};

export function failureMessage(
  err: unknown,
  fallback: string,
  overrides: FailureOverrides = {},
): string {
  if (!isApiError(err)) return fallback;
  const { failure } = err;
  const override = overrides[failure.kind];
  if (override) return override;
  if (failure.kind === 'forbidden') return FORBIDDEN[failure.code] ?? fallback;
  return DEFAULTS[failure.kind] ?? fallback;
}

/**
 * The wait a `rate_limited` failure asks for, in whole seconds, or `null` for
 * any other failure. A refusal without a figure waits {@link DEFAULT_WAIT_SEC}.
 */
export function retryAfterOf(err: unknown): number | null {
  if (!isApiError(err) || err.failure.kind !== 'rate_limited') return null;
  return err.failure.retryAfterSec ?? DEFAULT_WAIT_SEC;
}

/** What a rate limit with no `retry-after` waits before the button comes back. */
export const DEFAULT_WAIT_SEC = 30;

/**
 * True when a failure means the staff session has ended (X2 `session`). Staff
 * and admin surfaces report nothing for it: `ConnectionWatch` signs the device
 * out and routes to sign-in from one place, and a sentence on the sheet would
 * only flash on the way out. (The `signed_out` default above stays for a
 * surface with no global handler behind it.)
 */
export function isSessionFailure(err: unknown): boolean {
  return isApiError(err) && err.failure.kind === 'signed_out';
}

/** True when a failure is the connection's or the server's (X2 `connectivity`). */
export function isConnectivityFailure(err: unknown): boolean {
  return isApiError(err) && (err.failure.kind === 'offline' || err.failure.kind === 'server');
}
