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
