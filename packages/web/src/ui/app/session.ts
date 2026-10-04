/**
 * Pure, framework-free staff/admin session logic (UX-SPEC §6).
 *
 * This module owns the *decisions* — parsing persisted blobs and the boot
 * reconciliation against the server's session epoch — with no React or browser
 * dependency, so it can be unit-tested in isolation. `AuthContext.tsx` wires
 * them into state + storage I/O and is the single consumer.
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
}

const ANON: Reconciliation = { status: 'anon', actor: null, session: null };

/**
 * Boot decision (UX-SPEC §2 staff branch). Pure: callers handle the storage
 * side-effect a null `session` implies (clear).
 *
 *   - nothing persisted                   → 'anon'
 *   - stored epoch < serverEpoch          → REVOKED → 'anon' (clear)
 *   - else                                → 'active'
 */
export function reconcile(session: PersistedSession | null, serverEpoch: number): Reconciliation {
  if (!session) return ANON;
  // Revoked: admin bumped the epoch past this device's stored one.
  if (serverEpoch > session.epoch) return ANON;
  return { status: 'active', actor: actorFrom(session), session };
}
