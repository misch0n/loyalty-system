/**
 * Pure, framework-free staff/admin session logic (UX-SPEC §6).
 *
 * This module owns the security-critical *decisions* — parsing persisted blobs,
 * boot reconciliation against the server epoch + inactivity timeout, and the
 * idle check the timer uses — with no React or browser dependency so it can be
 * unit-tested in isolation. `AuthContext.tsx` wires these into state + storage
 * I/O and is the single consumer; this is the single source of truth.
 *
 * Persistence shape (no PII beyond the staff attribution NAME, required for the
 * activity log per §6):
 *   - trusted device  → localStorage   'cafe-loyalty.staffDevice'
 *   - ephemeral login → sessionStorage  'cafe-loyalty.staffSession'
 *   both hold { actorId, username, role, epoch, lastActivity }. The PIN is never
 *   persisted.
 */

import type { Actor } from '../../services/types';
import type { StaffRole } from '../../domain/models';

/** Inactivity window before a session locks (trusted) or ends (ephemeral). */
export const INACTIVITY_MS = 5 * 60 * 1000;

export type AuthStatus = 'anon' | 'active' | 'locked';

/** What we persist to recognize a trusted device and enforce the timeout. */
export interface PersistedSession {
  actorId: string;
  username: string;
  role: StaffRole;
  epoch: number;
  lastActivity: number;
}

function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'staff';
}

/** Parse a persisted blob, tolerating any malformed/legacy storage. */
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
      typeof o.epoch === 'number' &&
      typeof o.lastActivity === 'number'
    ) {
      return {
        actorId: o.actorId,
        username: o.username,
        role: o.role,
        epoch: o.epoch,
        lastActivity: o.lastActivity,
      };
    }
  } catch {
    // malformed JSON → treat as no session
  }
  return null;
}

/** The audit/UI actor projected from a persisted session. */
export function actorFrom(session: PersistedSession): Actor {
  return { id: session.actorId, username: session.username, role: session.role };
}

/** True once the inactivity window has fully elapsed since last activity. */
export function isIdle(session: PersistedSession, now: number): boolean {
  return now - session.lastActivity > INACTIVITY_MS;
}

/** A boot/timer reconciliation outcome. */
export interface Reconciliation {
  status: AuthStatus;
  /** Restored actor when status is 'active' or 'locked'; null on 'anon'. */
  actor: Actor | null;
  /** Session to keep (locked/active) or null when it should be cleared. */
  session: PersistedSession | null;
}

const ANON: Reconciliation = { status: 'anon', actor: null, session: null };

/**
 * Boot decision (UX-SPEC §2 staff branch). Pure: callers handle the storage
 * side-effects implied by a null `session` (clear) vs a kept one (persist/keep).
 *
 *   - stored epoch < serverEpoch          → REVOKED → 'anon' (clear)
 *   - idle, trusted                       → 'locked' (keep identity to unlock)
 *   - idle, ephemeral                     → 'anon'  (clear)
 *   - else                                → 'active'
 *
 * `trusted` is implied by which store the session came from; the caller passes
 * it through. A null session (nothing persisted) reconciles to 'anon'.
 */
export function reconcile(
  session: PersistedSession | null,
  serverEpoch: number,
  now: number,
  trusted: boolean,
): Reconciliation {
  if (!session) return ANON;
  // Revoked: admin bumped the epoch past this device's stored one.
  if (serverEpoch > session.epoch) return ANON;
  if (isIdle(session, now)) {
    // Trusted devices keep identity so the unlock screen can re-auth.
    if (trusted) return { status: 'locked', actor: actorFrom(session), session };
    return ANON;
  }
  return { status: 'active', actor: actorFrom(session), session };
}
