/**
 * StaffService — mock auth + admin staff management.
 *
 * Auth is MOCKED in the prototype: passwords are compared as plain strings (the
 * seed accounts are admin/admin and staff/staff). Production replaces this with
 * hashed passwords verified server-side — the call sites do not change.
 *
 * First sign-in is by username/password (`login`). The PIN (`loginWithPin`) is
 * the quick re-auth used when a remembered device unlocks after an idle lock.
 * Admins manage PINs via `create(..., pin, name)` and `setPin`. PINs are 4–8
 * digits, unique among active accounts, and are NEVER logged (they are
 * credentials). Accounts also carry a display `name` used for attribution/UI.
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
    const actor: Actor = {
      id: account.id,
      username: account.username,
      name: account.name,
      role: account.role,
    };
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
    const actor: Actor = {
      id: account.id,
      username: account.username,
      name: account.name,
      role: account.role,
    };
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
    pin?: string,
    name?: string,
  ): Promise<StaffAccount> {
    const trimmed = username.trim();
    if (!trimmed) throw new Error('Username is required.');
    if (!password) throw new Error('Password is required.');
    const cleanName = name?.trim() || undefined;
    const existing = await this.store.getStaffByUsername(trimmed);
    if (existing) throw new Error('That username is already taken.');
    let cleanPin: string | undefined;
    if (pin !== undefined && pin !== '') {
      cleanPin = this.validatePin(pin);
      await this.assertPinUnique(cleanPin);
    }
    const account = await this.store.createStaff({
      username: trimmed,
      name: cleanName,
      passwordHash: password, // mock: plain in prototype, hashed in production
      role,
      pin: cleanPin,
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

  /**
   * Set/replace a staff member's sign-in PIN (§6). Validates 4–8 digits and
   * enforces uniqueness among OTHER active accounts (sign-in resolves by PIN).
   * The PIN value is a credential — it is NEVER logged (audit detail is 'pin').
   */
  async setPin(actor: Actor, id: string, pin: string): Promise<void> {
    const cleanPin = this.validatePin(pin);
    await this.assertPinUnique(cleanPin, id);
    await this.store.setStaffPin(id, cleanPin);
    await this.audit.log(actor, 'staff.resetPassword', id, 'pin');
  }

  /** Trim + validate a PIN is 4–8 digits. Throws on bad input; returns the clean PIN. */
  private validatePin(pin: string): string {
    const trimmed = pin.trim();
    if (!trimmed) throw new Error('PIN is required.');
    if (!/^\d{4,8}$/.test(trimmed)) throw new Error('PIN must be 4–8 digits.');
    return trimmed;
  }

  /**
   * Ensure no OTHER active account already uses this PIN (`exceptId` is the
   * account being updated, so re-saving its own PIN doesn't collide).
   */
  private async assertPinUnique(pin: string, exceptId?: string): Promise<void> {
    const owner = await this.store.getStaffByPin(pin);
    if (owner && owner.id !== exceptId) {
      throw new Error('That PIN is already in use. Choose a different one.');
    }
  }
}
