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

/**
 * A refusal a service has already put into words for the person at the screen
 * ("That username is already taken.") — the one kind of `Error` a screen may
 * show by its `message`. An `ApiError`'s message, or a `TypeError`'s, is for
 * logs, not people.
 */
export class Refusal extends Error {
  constructor(sentence: string) {
    super(sentence);
    this.name = 'Refusal';
  }
}

export function isRefusal(value: unknown): value is Refusal {
  return value instanceof Refusal;
}
