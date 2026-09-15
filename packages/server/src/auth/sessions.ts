/**
 * Server-side sessions — the `sessions` table behind the cookie.
 *
 * The prototype never needed this: `AuthContext` kept the staff session in
 * localStorage and the customer's token in localStorage too. Both are client
 * state, which means both are advisory — and on iOS, ITP eventually deletes the
 * customer one, which `COLLAB-NOTES.md` records as the durability gap that is a
 * large part of why this backend is worth building.
 *
 * What moves here:
 *   • **The idle lock.** 5 minutes of inactivity, enforced against
 *     `last_seen_at` rather than a number the client keeps about itself.
 *   • **Epoch revocation.** "Sign out all devices" deletes rows, so it is true
 *     the instant it runs rather than true once each device notices.
 *   • **Recognition that survives.** A server-set HttpOnly cookie is not
 *     script-reachable and not ITP-prunable the way script-written storage is.
 *
 * Both session kinds live in one table because they are the same mechanism; the
 * rules that differ between them are stated on {@link SessionStore.resolve}.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { StaffRole } from '@cafe/shared/domain/models';
import { generateId } from '@cafe/shared/domain/tokens';
import type { Db } from '../db';
import { withTransaction } from '../db';

/**
 * Inactivity before a staff session locks. Mirrors `INACTIVITY_MS` in
 * `src/ui/app/session.ts` — the client still runs its own timer for the
 * immediate UI transition, but this is the one that decides.
 */
export const IDLE_LOCK_MS = 5 * 60 * 1000;

/** Absolute lifetime of a remembered terminal's session ("this is our till"). */
export const REMEMBERED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Absolute lifetime of a one-off sign-in on a borrowed device. */
export const EPHEMERAL_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * Absolute lifetime of a customer's card recognition. A year — the cookie is
 * the card, and re-recovering it is a round trip through email. Browsers cap
 * cookie lifetimes at ~400 days, so nothing longer would be honoured anyway.
 */
export const CUSTOMER_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type SessionKind = 'staff' | 'customer';
/** `'locked'` is a staff-only state: identity kept, PIN needed to act. */
export type SessionState = 'active' | 'locked';

/**
 * The staff identity behind a session.
 *
 * Deliberately declared here rather than imported from `src/services/types.ts`:
 * the server imports `domain/` and `ports/` through `@cafe/shared`, and reaching
 * into the SPA's service layer for a four-field interface would widen that seam
 * for no gain.
 */
export interface StaffActor {
  id: string;
  username: string;
  /** Display/attribution label. Falls back to `username` when absent. */
  name?: string;
  role: StaffRole;
}

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  staffId: string | null;
  customerId: string | null;
  /** "Remember this device" — a trusted terminal that PIN-unlocks after idling. */
  remembered: boolean;
  sessionEpoch: number;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface ResolvedSession {
  record: SessionRecord;
  state: SessionState;
  /** The staff account, for a staff session. `null` for a customer session. */
  actor: StaffActor | null;
}

/** What a freshly issued session hands back. The plaintexts exist only here. */
export interface IssuedSession {
  id: string;
  /** Goes in the HttpOnly cookie. Only its hash is ever stored. */
  token: string;
  /** Goes in the script-readable cookie and comes back as a header. */
  csrfToken: string;
  expiresAt: Date;
  sessionEpoch: number;
}

interface SessionJoinRow {
  id: string;
  kind: SessionKind;
  staff_id: string | null;
  customer_id: string | null;
  session_epoch: number;
  csrf_token_hash: string | null;
  remembered: boolean;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  username: string | null;
  name: string | null;
  role: StaffRole | null;
  active: boolean | null;
  config_epoch: number | null;
}

const RESOLVE_SQL = `
  SELECT s.id, s.kind, s.staff_id, s.customer_id, s.session_epoch, s.csrf_token_hash,
         s.remembered, s.created_at, s.last_seen_at, s.expires_at,
         a.username, a.name, a.role, a.active,
         c.session_epoch AS config_epoch
    FROM sessions s
    LEFT JOIN staff_accounts a ON a.id = s.staff_id
    LEFT JOIN program_config c ON c.id = 'singleton'
   WHERE s.token_hash = $1`;

/**
 * SHA-256, not argon2id.
 *
 * A session token is 256 bits of `randomBytes`, not a secret a person chose, so
 * there is no dictionary to slow down — and a stretched hash would have to be
 * computed on *every* authenticated request. The reason to hash at all is that a
 * dumped database must not yield live sessions, and a fast hash of a
 * high-entropy value does that completely.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 256 bits, URL-safe — a cookie value needs no escaping. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function toRecord(row: SessionJoinRow): SessionRecord {
  return {
    id: row.id,
    kind: row.kind,
    staffId: row.staff_id,
    customerId: row.customer_id,
    remembered: row.remembered,
    sessionEpoch: row.session_epoch,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}

function toActor(row: SessionJoinRow): StaffActor | null {
  if (!row.staff_id || !row.username || !row.role) return null;
  return {
    id: row.staff_id,
    username: row.username,
    name: row.name ?? undefined,
    role: row.role,
  };
}

export class SessionStore {
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    now: () => number = Date.now,
  ) {
    this.now = now;
  }

  /**
   * Issues a staff session. `remembered` is the "remember this device" flag: it
   * buys a long absolute lifetime and, after the idle window, a PIN unlock
   * instead of a full sign-out.
   */
  async issueStaff(staffId: string, remembered: boolean): Promise<IssuedSession> {
    const ttl = remembered ? REMEMBERED_TTL_MS : EPHEMERAL_TTL_MS;
    return this.issue({ kind: 'staff', subjectId: staffId, remembered, ttlMs: ttl });
  }

  /** Issues a customer session — the card recognition cookie (Phase 6). */
  async issueCustomer(customerId: string): Promise<IssuedSession> {
    return this.issue({
      kind: 'customer',
      subjectId: customerId,
      remembered: false,
      ttlMs: CUSTOMER_TTL_MS,
    });
  }

  private async issue(input: {
    kind: SessionKind;
    subjectId: string;
    remembered: boolean;
    ttlMs: number;
  }): Promise<IssuedSession> {
    const token = randomToken();
    const csrfToken = randomToken();
    const now = new Date(this.now());
    const expiresAt = new Date(this.now() + input.ttlMs);
    const epoch = await this.currentEpoch();

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO sessions (
         id, token_hash, kind, staff_id, customer_id, session_epoch, csrf_token_hash,
         remembered, created_at, last_seen_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
       RETURNING id`,
      [
        generateId(),
        hashToken(token),
        input.kind,
        input.kind === 'staff' ? input.subjectId : null,
        input.kind === 'customer' ? input.subjectId : null,
        epoch,
        hashToken(csrfToken),
        input.remembered,
        now,
        expiresAt,
      ],
    );

    const row = rows[0];
    if (!row) throw new Error('Session insert returned no row.');
    return { id: row.id, token, csrfToken, expiresAt, sessionEpoch: epoch };
  }

  /**
   * Resolves a cookie token to a session, or `null` for "not signed in".
   *
   * Every way a session can be over is applied here rather than at call sites,
   * and each one **deletes the row** so a dead session cannot be resolved twice:
   *
   *   • past its absolute `expires_at`                        → gone
   *   • staff, and its account is missing or disabled         → gone
   *   • staff, and its epoch is behind the program's          → gone (revoked)
   *   • staff, idle past {@link IDLE_LOCK_MS}, not remembered → gone
   *   • staff, idle past {@link IDLE_LOCK_MS}, remembered     → `'locked'`
   *
   * The idle rule and the epoch check are staff-only. A customer's card must
   * still be recognised after a fortnight of not visiting — that recognition *is*
   * the feature — and "sign out all devices" is an admin action about staff
   * terminals, not a way to un-issue every customer's card.
   */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token) return null;
    const { rows } = await this.db.query<SessionJoinRow>(RESOLVE_SQL, [hashToken(token)]);
    const row = rows[0];
    if (!row) return null;

    const now = this.now();
    const expire = async (): Promise<null> => {
      await this.revoke(row.id);
      return null;
    };

    if (row.expires_at.getTime() <= now) return expire();

    if (row.kind === 'customer') {
      return { record: toRecord(row), state: 'active', actor: null };
    }

    const actor = toActor(row);
    // A disabled or deleted account loses its live sessions immediately; without
    // this, "disable this employee" would only take effect at their next sign-in.
    if (!actor || row.active !== true) return expire();
    if (row.session_epoch < (row.config_epoch ?? 0)) return expire();

    const idle = now - row.last_seen_at.getTime() > IDLE_LOCK_MS;
    if (idle && !row.remembered) return expire();

    return { record: toRecord(row), state: idle ? 'locked' : 'active', actor };
  }

  /**
   * Constant-time CSRF check. Takes the header value and compares its hash with
   * the one stored beside the session — a double-submit token that is *bound to
   * the session*, so a token minted for another session does not pass.
   */
  async verifyCsrf(sessionId: string, headerValue: string | undefined): Promise<boolean> {
    if (!headerValue) return false;
    const { rows } = await this.db.query<{ csrf_token_hash: string | null }>(
      'SELECT csrf_token_hash FROM sessions WHERE id = $1',
      [sessionId],
    );
    const stored = rows[0]?.csrf_token_hash;
    if (!stored) return false;

    const expected = Buffer.from(stored, 'hex');
    const presented = Buffer.from(hashToken(headerValue), 'hex');
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }

  /** Records activity, which is what the idle lock is measured against. */
  async touch(sessionId: string): Promise<void> {
    await this.db.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [
      sessionId,
      new Date(this.now()),
    ]);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  /**
   * Admin "sign out all devices": bump the epoch **and** delete every staff
   * session row, in one transaction.
   *
   * Either half alone would do, which is the point — the rows make it true now,
   * the epoch makes it stay true for a device that had already loaded a page and
   * would otherwise keep using a cached identity. The caller's own session goes
   * with the rest; an admin doing this expects to sign in again too.
   *
   * The epoch is a **counter**, `+ 1`, not `Date.now()` as the prototype writes.
   * `program_config.session_epoch` is an `integer`, and a millisecond timestamp
   * overflows `int4`. Monotonic is all the comparison needs.
   */
  async revokeAllStaff(): Promise<number> {
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query<{ session_epoch: number }>(
        `UPDATE program_config SET session_epoch = session_epoch + 1, updated_at = now()
          WHERE id = 'singleton' RETURNING session_epoch`,
      );
      const row = rows[0];
      if (!row) throw new Error('program_config is empty — has the database been migrated?');
      await tx.query("DELETE FROM sessions WHERE kind = 'staff'");
      return row.session_epoch;
    });
  }

  /** The program's current revocation epoch (0 before any revocation). */
  async currentEpoch(): Promise<number> {
    const { rows } = await this.db.query<{ session_epoch: number }>(
      "SELECT session_epoch FROM program_config WHERE id = 'singleton'",
    );
    return rows[0]?.session_epoch ?? 0;
  }

  /**
   * Deletes sessions past their absolute expiry. Nothing depends on it for
   * correctness — {@link resolve} refuses an expired row whether or not it has
   * been swept — it just keeps the table from growing forever. Phase 8 schedules
   * it alongside the `idempotency_keys` TTL sweep.
   */
  async sweepExpired(): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM sessions WHERE expires_at <= $1', [
      new Date(this.now()),
    ]);
    return rowCount ?? 0;
  }
}
