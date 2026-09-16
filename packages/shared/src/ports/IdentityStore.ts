/**
 * IdentityStore — "this browser remembers which customer it belongs to".
 * Stores ONLY the opaque customer token, never PII.
 * Async to keep call sites identical to the production adapter (a first-party
 * server-set HttpOnly cookie / session), which is necessarily async over HTTP.
 * Prototype: localStorage. Production: server cookie/session.
 */
export interface IdentityStore {
  /** The remembered customer token, or null if this browser isn't recognized. */
  get(): Promise<string | null>;
  /** Remember this customer token on this browser. */
  set(token: string): Promise<void>;
  /** Forget the remembered customer (e.g. on a shared/staff device). */
  clear(): Promise<void>;
}
