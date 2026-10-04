/**
 * The one typed failure every API call can end in (`UI-RECONCILIATION.md` X2).
 *
 * `ApiClient.request` is the only place that looks at an HTTP status or a
 * refusal body. Everything above it — services, then screens — sees an
 * {@link ApiError} carrying an {@link ApiFailure}, and decides what to do from
 * its `kind` and, through {@link failureScope}, who should say so.
 *
 * ## Checked against the server, not the plan
 *
 * UI-PLAN's draft union was `offline | locked | forbidden | rate_limited |
 * email_in_use | conflict | server`. Read against `packages/server` after UI-1b:
 *
 *   - **`locked` is gone.** No route returns `401 locked` since the PIN and the
 *     idle lock were retired, and `GET /auth/session` answers `active | anon`.
 *   - **`signed_out` is the session member** the draft lacked: `401
 *     unauthorized` from a staff guard means the session has ended — its TTL
 *     ran out, "Sign out all devices" bumped the epoch, or the account was
 *     disabled or deleted. All four look identical on the wire, and all four
 *     have the same remedy.
 *   - **`not_found` and `rejected`** exist because the server does answer 404
 *     and 400 with remediable codes (`customer_not_found`, `invalid_details`,
 *     `invalid_code`, `range_too_wide`, the `reversal_*` refusals…). A wrong
 *     password is `rejected` with code `invalid_credentials` — a 401, but an
 *     action failure, so it must never trip the session handler.
 *   - **`forbidden`** is every 403: `forbidden` (wrong role), `csrf_failed`,
 *     `forbidden_origin` and `staff_device`. The code says which.
 *
 * `over_cap` and `already_spent` are **not** here: the counter commit reports
 * them as values (`CommitResult`, `RejectedRedemption`), and `ApiStore` hands
 * the commit's refusal body back as one rather than throwing.
 */

export type ApiFailure =
  /** The request never got an HTTP answer: no network, DNS, CORS, or the timeout fired. */
  | { kind: 'offline' }
  /** The staff session has ended (401 `unauthorized`). Routed to sign-in from one place. */
  | { kind: 'signed_out' }
  /** 403 — the role, the CSRF token, the origin, or a till doing a customer's thing. */
  | { kind: 'forbidden'; code: string }
  /** 404 — nothing there, or nothing this caller may see (the server does not distinguish). */
  | { kind: 'not_found'; code: string }
  /** 429. `retryAfterSec` drives a countdown; `null` when the server gave no figure. */
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  /** 409 `email_in_use` — the one conflict a customer screen answers with "recover it". */
  | { kind: 'email_in_use' }
  /** Any other 409: `username_taken`, `already_reversed`, `cannot_delete_self`… */
  | { kind: 'conflict'; code: string }
  /** 400, or a 4xx with no better home: the request was understood and refused. */
  | { kind: 'rejected'; code: string }
  /** 5xx, or an answer that was not the API's (a proxy's 502 page). */
  | { kind: 'server'; status: number };

export type ApiFailureKind = ApiFailure['kind'];

/**
 * Who reports a failure (X2's three routing rules):
 *   - `session`      → **global only**: one handler routes to sign-in.
 *   - `connectivity` → **both**: the persistent banner *and* the point of action.
 *   - `action`       → **local only**: on the field or control. Never a toast.
 */
export type FailureScope = 'session' | 'connectivity' | 'action';

export function failureScope(failure: ApiFailure): FailureScope {
  switch (failure.kind) {
    case 'signed_out':
      return 'session';
    case 'offline':
    case 'server':
      return 'connectivity';
    default:
      return 'action';
  }
}

/**
 * Thrown by every API call that does not succeed. The message names the kind
 * and the code and nothing else — never the path, which can carry a card token,
 * and never the body, which can carry an address (`CLAUDE.md`: no PII in errors).
 */
export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(describe(failure));
    this.name = 'ApiError';
  }

  get kind(): ApiFailureKind {
    return this.failure.kind;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function describe(failure: ApiFailure): string {
  switch (failure.kind) {
    case 'forbidden':
    case 'not_found':
    case 'conflict':
    case 'rejected':
      return `API ${failure.kind}: ${failure.code}`;
    case 'rate_limited':
      return `API rate_limited${failure.retryAfterSec === null ? '' : ` (${failure.retryAfterSec}s)`}`;
    case 'server':
      return `API server error (${failure.status})`;
    default:
      return `API ${failure.kind}`;
  }
}

/**
 * Map a non-2xx answer to its failure. `body` is the parsed JSON, or `null`
 * when there was none or it did not parse — which is how a proxy's HTML error
 * page arrives, and why every branch has a fallback code.
 */
export function classifyResponse(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
): ApiFailure {
  const code = errorCode(body);

  if (status >= 500) return { kind: 'server', status };
  if (status === 401) {
    return code === 'unauthorized' || code === 'unknown'
      ? { kind: 'signed_out' }
      : { kind: 'rejected', code };
  }
  if (status === 403) return { kind: 'forbidden', code };
  if (status === 404) return { kind: 'not_found', code };
  if (status === 409) {
    return code === 'email_in_use' ? { kind: 'email_in_use' } : { kind: 'conflict', code };
  }
  if (status === 429) return { kind: 'rate_limited', retryAfterSec: retryAfter(body, retryAfterHeader) };
  if (status >= 400) return { kind: 'rejected', code };
  // A 1xx/3xx reaching here is not something this API sends.
  return { kind: 'server', status };
}

function errorCode(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error) return error;
  }
  return 'unknown';
}

function retryAfter(body: unknown, header: string | null): number | null {
  if (body && typeof body === 'object' && 'retryAfterSec' in body) {
    const value = (body as { retryAfterSec: unknown }).retryAfterSec;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.ceil(value);
  }
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  return null;
}
