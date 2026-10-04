/**
 * The API's failure surface, as the UI may see it.
 *
 * Screens talk to services, never to adapters (`CLAUDE.md`), but every service
 * call can now fail with an `ApiError` thrown from beneath them. This re-export
 * is how a screen names that error — and asks {@link failureScope} whether it is
 * its own to report — without importing from `adapters/`.
 */

export {
  ApiError,
  isApiError,
  failureScope,
  type ApiFailure,
  type ApiFailureKind,
  type FailureScope,
} from '../adapters/http/ApiError';
export type { ApiEvent, ApiEvents, ApiListener } from '../adapters/http/ApiClient';
