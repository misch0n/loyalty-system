/**
 * StaffService — staff sign-in and admin account management, over the API.
 *
 * Sign-in is `POST /auth/login`: the plaintext goes over TLS, the server checks
 * it against an argon2id digest and answers with an HttpOnly session cookie. The
 * browser never sees a credential it did not type, and never a hash
 * (BACKEND-PLAN §4-A). "Remember me" picks the session's lifetime — 30 days
 * rather than 12 hours — and nothing else.
 *
 * **There is no PIN.** The staff device is a shared till (SCOPE-DECISIONS §6.3,
 * register S1): a login lasts until its TTL, there is no idle lock to unlock,
 * and staff carry a username and a password. Attribution is the signed-in
 * *account* — the routes take the actor from the session and write the audit
 * rows themselves, so nothing here logs anything.
 *
 * The admin methods' refusals that a person can act on come back as an `Error`
 * with a sentence in it, as they always have; anything else is the `ApiError`
 * the client threw (`services/errors.ts`).
 */

import type { StaffAccount, StaffRole } from '@cafe/shared/domain/models';
import type { DataStore } from '@cafe/shared/ports/DataStore';
import { isApiError } from './errors';
import type { Actor, Api } from './types';

export interface LoginResult {
  ok: boolean;
  actor?: Actor;
  /** The session epoch the login was issued under (on success). */
  epoch?: number;
  reason?: string;
}

/** `GET /auth/session` — what the server says this device is signed in as. */
export type StaffSession =
  | { status: 'active'; actor: Actor; epoch: number; remembered: boolean }
  | { status: 'anon'; epoch: number };

/** The refusals worth a sentence, by the code the server answers with. */
const REFUSALS: Record<string, string> = {
  username_taken: 'That username is already taken.',
  cannot_delete_self: 'You can’t delete the account you’re signed in with.',
  cannot_disable_self: 'You can’t disable the account you’re signed in with.',
};

export class StaffService {
  constructor(
    private readonly store: DataStore,
    private readonly api: Api,
  ) {}

  /**
   * Sign in. A wrong password — or a disabled account, or no such account; the
   * server will not say which — resolves `{ ok: false }` rather than throwing,
   * because it is the answer to the question, not a failure to ask it. So is
   * being rate-limited. Anything else (offline, the server down) throws.
   */
  async login(username: string, password: string, remember = false): Promise<LoginResult> {
    try {
      const session = await this.api.request<{ actor: Actor; epoch: number }>('POST', '/auth/login', {
        username: username.trim(),
        password,
        remember,
      });
      return { ok: true, actor: session.actor, epoch: session.epoch };
    } catch (err) {
      if (!isApiError(err)) throw err;
      const { failure } = err;
      if (failure.kind === 'rejected' && failure.code === 'invalid_credentials') {
        return { ok: false, reason: 'Wrong username or password, or the account is disabled.' };
      }
      if (failure.kind === 'rate_limited') {
        return { ok: false, reason: tooManyAttempts(failure.retryAfterSec) };
      }
      throw err;
    }
  }

  /** Sign this device out. Succeeds with no session at all. */
  async logout(): Promise<void> {
    await this.api.request('POST', '/auth/logout');
  }

  /** What the session cookie on this device resolves to, if anything. */
  session(): Promise<StaffSession> {
    return this.api.request('GET', '/auth/session');
  }

  /** The current session epoch (0 when no revocation has ever occurred). */
  async currentSessionEpoch(): Promise<number> {
    return (await this.session()).epoch;
  }

  /**
   * Admin "sign out all devices": the server deletes every staff session and
   * bumps the epoch in one transaction — **this device's session included**.
   * Resolves the new epoch.
   */
  async revokeAllSessions(): Promise<number> {
    const { epoch } = await this.api.request<{ epoch: number }>('POST', '/auth/logout-all');
    return epoch;
  }

  list(): Promise<StaffAccount[]> {
    return this.store.listStaff();
  }

  async create(
    username: string,
    password: string,
    role: StaffRole,
    name?: string,
  ): Promise<StaffAccount> {
    const trimmed = username.trim();
    if (!trimmed) throw new Error('Username is required.');
    if (!password) throw new Error('Password is required.');
    return explained(
      this.store.createStaff({
        username: trimmed,
        name: name?.trim() || undefined,
        password,
        role,
      }),
    );
  }

  setActive(id: string, active: boolean): Promise<void> {
    return explained(this.store.setStaffActive(id, active));
  }

  /**
   * Permanently remove an account. The server refuses deleting your own; the
   * last-admin check is the client's, for a sentence instead of a round trip.
   */
  async remove(actor: Actor, id: string): Promise<void> {
    if (actor.id === id) throw new Error(REFUSALS.cannot_delete_self);
    const all = await this.store.listStaff();
    const target = all.find((a) => a.id === id);
    if (!target) throw new Error('Account not found.');
    if (target.role === 'admin') {
      const otherAdmins = all.filter((a) => a.role === 'admin' && a.id !== id && a.active);
      if (otherAdmins.length === 0) {
        throw new Error('Can’t delete the last admin account.');
      }
    }
    await explained(this.store.deleteStaff(id));
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    if (!newPassword) throw new Error('New password is required.');
    await explained(this.store.setStaffPassword(id, newPassword));
  }
}

/** Swap a refusal the admin can act on for its sentence; pass anything else through. */
async function explained<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (isApiError(err) && err.failure.kind === 'conflict') {
      const sentence = REFUSALS[err.failure.code];
      if (sentence) throw new Error(sentence);
    }
    throw err;
  }
}

function tooManyAttempts(retryAfterSec: number | null): string {
  if (retryAfterSec === null) return 'Too many sign-in attempts. Try again later.';
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
