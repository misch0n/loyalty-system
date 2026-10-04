/**
 * How the admin screens word a failed call — one place, so "can't reach the
 * server", "the server failed" and "this page is out of date" read the same on
 * every admin sheet (UI-4, X2).
 *
 * Built on {@link failureMessage}; this adds what only admin needs:
 *   - **A session failure says nothing here** (`null`). X2 routes `signed_out`
 *     globally: `ConnectionWatch` signs the device out and goes to sign-in, so
 *     a sentence on the sheet would only flash on the way out. Every admin
 *     surface renders nothing for `null`.
 *   - **`rate_limited`** without the countdown wording: no admin control runs a
 *     countdown (`useRetryCountdown`), so "wait for the countdown" would point at
 *     nothing. A caller loading data, not changing it, overrides it.
 *   - **a 403 `forbidden`** — the role check, as opposed to the CSRF/origin/till
 *     403s whose shared copy `failureMessage` already has.
 *
 * {@link adminActionMessage} additionally shows a {@link Refusal} as written:
 * `StaffService` throws one for the refusals an admin can act on ("That
 * username is already taken."). Any other error — an `ApiError` ("API
 * offline"), a `TypeError` from a bug — is never shown by its `.message`.
 */
import { failureMessage, isSessionFailure, type FailureOverrides } from '../../../common/failure';
import { isApiError, isRefusal } from '../../../../services/errors';

const RATE_LIMITED = 'Too many changes in a row. Wait a moment, then try again.';
const ADMIN_ONLY = 'This needs an admin account. Sign in as an admin, then try again.';

/**
 * A failed admin call as one sentence, or `null` when the session has ended
 * (reported globally — show nothing). Anything but an `ApiError` gets `fallback`.
 */
export function adminFailureMessage(
  err: unknown,
  fallback: string,
  overrides: FailureOverrides = {},
): string | null {
  if (isSessionFailure(err)) return null;
  const roleRefused =
    isApiError(err) && err.failure.kind === 'forbidden' && err.failure.code === 'forbidden';
  return failureMessage(err, fallback, {
    rate_limited: RATE_LIMITED,
    ...(roleRefused ? { forbidden: ADMIN_ONLY } : {}),
    ...overrides,
  });
}

/**
 * As {@link adminFailureMessage}, but a `StaffService` {@link Refusal} is shown
 * as written.
 */
export function adminActionMessage(
  err: unknown,
  fallback: string,
  overrides: FailureOverrides = {},
): string | null {
  if (isRefusal(err)) return err.message;
  return adminFailureMessage(err, fallback, overrides);
}
