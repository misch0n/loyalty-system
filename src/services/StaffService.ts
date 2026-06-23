/**
 * StaffService — mock auth + admin staff management.
 *
 * Auth is MOCKED in the prototype: passwords are compared as plain strings (the
 * seed accounts are admin/admin and staff/staff). Production replaces this with
 * hashed passwords verified server-side — the call sites do not change.
 */

import type { StaffAccount, StaffRole } from '../domain/models';
import type { DataStore } from '../ports/DataStore';
import type { AuditService } from './AuditService';
import type { Actor } from './types';

export interface LoginResult {
  ok: boolean;
  actor?: Actor;
  reason?: string;
}

export class StaffService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditService,
  ) {}

  /** Mock login. Returns an Actor on success; logs success/failure to audit. */
  async login(username: string, password: string): Promise<LoginResult> {
    const account = await this.store.getStaffByUsername(username.trim());
    if (!account || !account.active || account.passwordHash !== password) {
      // A disabled or departed employee must not get in. Never log the username
      // as PII-adjacent detail — record only the attempted id if known.
      await this.audit.log(
        { id: account?.id ?? 'unknown', role: 'system' },
        'staff.login.failed',
        account?.id,
      );
      return { ok: false, reason: 'Wrong username or password, or the account is disabled.' };
    }
    const actor: Actor = { id: account.id, username: account.username, role: account.role };
    await this.audit.log(actor, 'staff.login', account.id);
    return { ok: true, actor };
  }

  /**
   * PIN sign-in (§6). Resolves the active staff account whose PIN matches and
   * returns its Actor (username = the staff NAME used for attribution). The
   * long-press only reveals the screen; the PIN is the actual access control.
   */
  async loginWithPin(pin: string): Promise<LoginResult> {
    const account = await this.store.getStaffByPin(pin.trim());
    if (!account || !account.active) {
      // Never log the PIN (a credential) or any account detail beyond the id.
      await this.audit.log({ id: 'unknown', role: 'system' }, 'staff.login.failed');
      return { ok: false, reason: 'Wrong PIN, or the account is disabled.' };
    }
    const actor: Actor = { id: account.id, username: account.username, role: account.role };
    await this.audit.log(actor, 'staff.login', account.id);
    return { ok: true, actor };
  }

  /**
   * Admin "sign out all devices": bump the program's session epoch so every
   * device with an older stored epoch is forced to re-authenticate. Append-only
   * in spirit — the epoch only ever moves forward (config-backed, not a counter
   * the UI mutates). Returns the new epoch.
   */
  async revokeAllSessions(actor: Actor): Promise<number> {
    const epoch = Date.now();
    await this.store.updateConfig({ sessionEpoch: epoch });
    await this.audit.log(actor, 'config.update', undefined, 'sessionEpoch');
    return epoch;
  }

  /** The current session epoch (0 when no revocation has ever occurred). */
  async currentSessionEpoch(): Promise<number> {
    const config = await this.store.getConfig();
    return config.sessionEpoch ?? 0;
  }

  list(): Promise<StaffAccount[]> {
    return this.store.listStaff();
  }

  async create(
    actor: Actor,
    username: string,
    password: string,
    role: StaffRole,
  ): Promise<StaffAccount> {
    const trimmed = username.trim();
    if (!trimmed) throw new Error('Username is required.');
    if (!password) throw new Error('Password is required.');
    const existing = await this.store.getStaffByUsername(trimmed);
    if (existing) throw new Error('That username is already taken.');
    const account = await this.store.createStaff({
      username: trimmed,
      passwordHash: password, // mock: plain in prototype, hashed in production
      role,
    });
    await this.audit.log(actor, 'staff.create', account.id, role);
    return account;
  }

  async setActive(actor: Actor, id: string, active: boolean): Promise<void> {
    await this.store.setStaffActive(id, active);
    await this.audit.log(actor, active ? 'staff.enable' : 'staff.disable', id);
  }

  async resetPassword(actor: Actor, id: string, newPassword: string): Promise<void> {
    if (!newPassword) throw new Error('New password is required.');
    await this.store.setStaffPassword(id, newPassword);
    await this.audit.log(actor, 'staff.resetPassword', id);
  }
}
