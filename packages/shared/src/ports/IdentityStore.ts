/**
 * IdentityStore — "this browser remembers which customer it belongs to".
 * Stores ONLY the opaque customer token, never PII.
 * Async because the adapter is a round trip: the SPA's `ServerIdentityStore`
 * reads and writes a server-set HttpOnly cookie through `/me`, the recognition
 * that survives iOS tracking prevention. Registration, opening a card link and
 * a completed recovery also bind the device server-side, without this port.
 */
export interface IdentityStore {
  /** The remembered customer token, or null if this browser isn't recognized. */
  get(): Promise<string | null>;
  /** Remember this customer token on this browser. */
  set(token: string): Promise<void>;
  /** Forget the remembered customer (e.g. on a shared/staff device). */
  clear(): Promise<void>;
}
