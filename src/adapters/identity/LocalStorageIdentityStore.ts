/**
 * LocalStorageIdentityStore — prototype stand-in for the IdentityStore seam.
 *
 * Remembers ONLY the customer's opaque token under a single localStorage key —
 * never any PII. iOS Safari may evict localStorage after ~7 idle days, so this
 * is a best-effort cache, not durable storage; production swaps to a durable
 * first-party server cookie. All access is wrapped in try/catch so that
 * environments with localStorage disabled (Safari private mode, etc.) degrade
 * to "not recognized" (get → null) rather than throwing.
 */
import type { IdentityStore } from '../../ports/IdentityStore';

const STORAGE_KEY = 'cafe-loyalty.customer';

export class LocalStorageIdentityStore implements IdentityStore {
  async get(): Promise<string | null> {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  async set(token: string): Promise<void> {
    try {
      window.localStorage.setItem(STORAGE_KEY, token);
    } catch {
      // Best-effort: if storage is unavailable, silently degrade.
    }
  }

  async clear(): Promise<void> {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best-effort: nothing to clear if storage is unavailable.
    }
  }
}
