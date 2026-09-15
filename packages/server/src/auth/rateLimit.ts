/**
 * Failed-attempt limiting with lockout.
 *
 * This is the control that actually protects a PIN. A four-digit PIN has no
 * entropy worth the name — `hashing.ts` says so, SCOPE-DECISIONS §2.3 says the
 * same about a typed recovery code — so what stands between an attacker and the
 * whole keyspace is how many guesses they get, not how the guess is hashed.
 *
 * Deliberately counts **failures**, not requests: a till signing in correctly all
 * day is never throttled, while an attacker is locked out after `limit` misses.
 * Callers must therefore `check()` before verifying a credential and `fail()`
 * only after one is actually rejected, so a locked-out key never reaches the
 * (deliberately expensive) argon2 verify.
 *
 * In-memory and per-process, which is the right size for a single-café, single-
 * container API. If this ever runs behind more than one instance the counters
 * need to move to Postgres or Redis — noted rather than pre-built.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the key may be used again. `0` when allowed. */
  retryAfterSec: number;
}

export interface AttemptLimiterOptions {
  /** Failures allowed inside `windowMs` before the key locks out. */
  limit: number;
  windowMs: number;
  lockoutMs: number;
  /** Injectable clock, so the tests can travel in time instead of sleeping. */
  now?: () => number;
  /** Entries held before a sweep runs. Bounds memory against key-space flooding. */
  maxEntries?: number;
}

interface Entry {
  failures: number;
  windowStart: number;
  /** Epoch ms the lockout ends; `0` when not locked out. */
  lockedUntil: number;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSec: 0 };

export class AttemptLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(private readonly options: AttemptLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  /** Non-consuming: asks whether this key may attempt right now. */
  check(key: string): RateLimitDecision {
    const entry = this.entries.get(key);
    if (!entry) return ALLOWED;
    return this.decide(entry, this.now());
  }

  /** Records a rejected credential. Returns the key's state after counting it. */
  fail(key: string): RateLimitDecision {
    const now = this.now();
    this.sweepIfCrowded(now);

    const existing = this.entries.get(key);
    // A served lockout or a rolled-over window both start the count again: the
    // limit is "failures in a window", not "failures ever".
    const stale =
      !existing ||
      (existing.lockedUntil > 0 && existing.lockedUntil <= now) ||
      now - existing.windowStart >= this.options.windowMs;

    const entry: Entry = stale ? { failures: 0, windowStart: now, lockedUntil: 0 } : existing;
    entry.failures += 1;
    if (entry.failures >= this.options.limit) {
      entry.lockedUntil = now + this.options.lockoutMs;
    }
    this.entries.set(key, entry);
    return this.decide(entry, now);
  }

  /** Clears a key after a successful credential check. */
  succeed(key: string): void {
    this.entries.delete(key);
  }

  /** Drops entries that are neither locked out nor inside their window. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (this.isSpent(entry, now)) this.entries.delete(key);
    }
  }

  private decide(entry: Entry, now: number): RateLimitDecision {
    if (entry.lockedUntil > now) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    return ALLOWED;
  }

  private isSpent(entry: Entry, now: number): boolean {
    return entry.lockedUntil <= now && now - entry.windowStart >= this.options.windowMs;
  }

  /**
   * An attacker rotating usernames would otherwise grow the map without bound.
   * Sweeping only past the threshold keeps the common path O(1).
   */
  private sweepIfCrowded(now: number): void {
    if (this.entries.size < this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (this.isSpent(entry, now)) this.entries.delete(key);
    }
  }
}
