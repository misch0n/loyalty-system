/**
 * Pure, framework-free staff/admin session logic (UX-SPEC §6).
 *
 * This module owns the *decisions* — parsing persisted blobs and the boot
 * reconciliation against `GET /auth/session` (register X1) — with no React or
 * browser dependency, so it can be unit-tested in isolation. `AuthContext.tsx`
 * wires them into state + storage I/O and is the single consumer.
 *
 * There is no inactivity rule (SCOPE-DECISIONS §6.3, register S1): the staff
 * device is a shared till, and a login lasts until its server-side TTL — 30
 * days remembered, 12 hours otherwise — or until "Sign out all devices" bumps
 * the epoch. The cookie is the session; what is persisted here is only what the
 * screens need to render the signed-in account before the first API answer.
 *
 * Persistence shape (no PII beyond the staff attribution NAME):
 *   - remembered login → localStorage   'cafe-loyalty.staffDevice'
 *   - ephemeral login  → sessionStorage  'cafe-loyalty.staffSession'
 *   both hold { actorId, username, name?, role, epoch }. No credential is ever
 *   persisted.
 */

import type { StaffSession } from '../../services/StaffService';
import type { Actor } from '../../services/types';
import type { StaffRole } from '@cafe/shared/domain/models';

export type AuthStatus = 'anon' | 'active';

/** What we persist to render the signed-in account across a reload. */
export interface PersistedSession {
  actorId: string;
  username: string;
  /** Display name, persisted so the panel can greet by name after a reload. */
  name?: string;
  role: StaffRole;
  epoch: number;
}

function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'staff';
}

/**
 * Parse a persisted blob, tolerating any malformed/legacy storage — including
 * the `lastActivity` an idle-lock-era blob carries, which is simply ignored.
 */
export function parseSession(raw: string | null): PersistedSession | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    if (
      typeof o.actorId === 'string' &&
      typeof o.username === 'string' &&
      isStaffRole(o.role) &&
      typeof o.epoch === 'number'
    ) {
      return {
        actorId: o.actorId,
        username: o.username,
        name: typeof o.name === 'string' ? o.name : undefined,
        role: o.role,
        epoch: o.epoch,
      };
    }
  } catch {
    // malformed JSON → treat as no session
  }
  return null;
}

/** The UI actor projected from a persisted session. */
export function actorFrom(session: PersistedSession): Actor {
  return {
    id: session.actorId,
    username: session.username,
    name: session.name,
    role: session.role,
  };
}

/** A boot reconciliation outcome. */
export interface Reconciliation {
  status: AuthStatus;
  /** Restored actor when status is 'active'; null on 'anon'. */
  actor: Actor | null;
  /** Session to keep, or null when it should be cleared. */
  session: PersistedSession | null;
  /**
   * Whether the login is remembered, as the server reports it — or `null` when
   * the server did not answer, meaning "keep what was persisted, where it was".
   */
  trusted: boolean | null;
}

const ANON: Reconciliation = { status: 'anon', actor: null, session: null, trusted: null };

/**
 * Boot decision (register X1). Pure: callers handle the storage side-effects a
 * null `session` (clear) or a non-null `trusted` (re-persist) implies.
 *
 * `server` is what `GET /auth/session` answered, or `null` when it could not be
 * asked — offline, the server down. The server is the ground truth; the
 * persisted blob is only what lets the screens render before it answers.
 *
 *   - nothing persisted        → 'anon' (the caller need not ask at all)
 *   - server unreachable       → 'active' from the persisted blob. Not being
 *                                able to ask is not being signed out; the
 *                                connectivity banner owns that (register X2).
 *   - server says 'anon'       → 'anon' (clear). Covers every way a session ends
 *                                while the page is closed: its TTL, sign-out on
 *                                another tab, the account disabled or deleted,
 *                                and "Sign out all devices".
 *   - server says 'active'     → 'active' as the server's account — name, role
 *                                and epoch refreshed from the answer, and
 *                                "remembered" as the cookie says.
 *
 * There is no client-side epoch comparison any more. The server checks each
 * session's epoch against the program's on every request and answers `anon`
 * for one that "Sign out all devices" revoked, so a stored epoch could only ever
 * agree with it — or, after a newer sign-in in another tab, wrongly disagree.
 */
export function reconcile(
  session: PersistedSession | null,
  server: StaffSession | null,
): Reconciliation {
  if (!session) return ANON;
  if (server === null) {
    return { status: 'active', actor: actorFrom(session), session, trusted: null };
  }
  if (server.status === 'anon') return ANON;
  const refreshed: PersistedSession = {
    actorId: server.actor.id,
    username: server.actor.username,
    name: server.actor.name,
    role: server.actor.role,
    epoch: server.epoch,
  };
  return {
    status: 'active',
    actor: actorFrom(refreshed),
    session: refreshed,
    trusted: server.remembered,
  };
}
