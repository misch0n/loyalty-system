/**
 * StaffService against the real server: sign-in, the session, and the admin's
 * account management. There is no PIN anywhere (S1) — a login is a username and
 * a password, and it lasts until its TTL, a revocation, or the account going.
 */

import { describe, expect, it } from 'vitest';
import { isApiError } from '../../src/services/errors';
import { adminDevice, device, newAccount, signedIn, unique } from './harness';

/** The `ApiFailure` kind a rejected promise carried, or `'not an ApiError'`. */
async function failureOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (err) {
    return isApiError(err) ? err.failure.kind : 'not an ApiError';
  }
  throw new Error('expected the call to fail');
}

describe('sign-in', () => {
  it('signs in with the right password and the session says who', async () => {
    const login = await newAccount('staff');
    const till = await device();

    const result = await till.services.staff.login(login.username, login.password);
    expect(result.ok).toBe(true);
    expect(result.actor).toMatchObject({ id: login.id, username: login.username, role: 'staff' });

    const session = await till.services.staff.session();
    expect(session).toMatchObject({ status: 'active', actor: { id: login.id } });
    expect(result.epoch).toBe(session.epoch);
  });

  it('answers a wrong password with a reason, not a throw', async () => {
    const login = await newAccount('staff');
    const till = await device();

    const result = await till.services.staff.login(login.username, 'not-the-password');
    expect(result).toEqual({
      ok: false,
      reason: 'Wrong username or password, or the account is disabled.',
    });
    expect((await till.services.staff.session()).status).toBe('anon');
  });

  it('answers an unknown username exactly like a wrong password', async () => {
    const till = await device();
    const result = await till.services.staff.login(`nobody-${unique()}`, 'whatever');
    expect(result.reason).toBe('Wrong username or password, or the account is disabled.');
  });

  it('keeps a disabled account out', async () => {
    const admin = await adminDevice();
    const login = await newAccount('staff');
    await admin.services.staff.setActive(login.id, false);

    const till = await device();
    expect((await till.services.staff.login(login.username, login.password)).ok).toBe(false);
  });

  it('says how long to wait, as a figure to count down, once an account is under attack', async () => {
    const login = await newAccount('staff');
    const till = await device();
    for (let i = 0; i < 5; i += 1) {
      await till.services.staff.login(login.username, 'wrong');
    }
    const result = await till.services.staff.login(login.username, login.password);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Too many sign-in attempts. Wait for the countdown, then try again.');
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it('remembers the login only when asked to', async () => {
    const login = await newAccount('staff');
    const remembered = await device();
    await remembered.services.staff.login(login.username, login.password, true);
    expect(await remembered.services.staff.session()).toMatchObject({ remembered: true });

    const ephemeral = await device();
    await ephemeral.services.staff.login(login.username, login.password, false);
    expect(await ephemeral.services.staff.session()).toMatchObject({ remembered: false });
  });

  it('signs out: the session is gone and staff calls answer signed_out', async () => {
    const till = await signedIn('staff');
    await till.services.staff.logout();

    expect((await till.services.staff.session()).status).toBe('anon');
    expect(await failureOf(till.services.config.get())).toBe('signed_out');
  });

  it('signs out a device with no session without complaint', async () => {
    const stranger = await device();
    await expect(stranger.services.staff.logout()).resolves.toBeUndefined();
  });
});

describe('account management (admin)', () => {
  it('creates an account that can sign in with the password it was given', async () => {
    const admin = await adminDevice();
    const username = `new-${unique()}`;
    const account = await admin.services.staff.create(username, 'first-password', 'staff', ' Maria ');
    expect(account).toMatchObject({ username, name: 'Maria', role: 'staff', active: true });
    // The plaintext went over the wire once and was hashed there; nothing comes back.
    expect(JSON.stringify(account)).not.toContain('first-password');

    const till = await device();
    expect((await till.services.staff.login(username, 'first-password')).ok).toBe(true);
  });

  it('refuses a username that is taken, in a sentence', async () => {
    const admin = await adminDevice();
    const login = await newAccount('staff');
    await expect(admin.services.staff.create(login.username, 'pw-12345', 'staff')).rejects.toThrow(
      'That username is already taken.',
    );
  });

  it('requires a username and a password before asking the server', async () => {
    const admin = await adminDevice();
    await expect(admin.services.staff.create('  ', 'pw', 'staff')).rejects.toThrow('Username is required.');
    await expect(admin.services.staff.create('someone', '', 'staff')).rejects.toThrow('Password is required.');
  });

  it('lists accounts without a credential in sight', async () => {
    const admin = await adminDevice();
    const login = await newAccount('staff');
    const accounts = await admin.services.staff.list();
    const listed = accounts.find((a) => a.id === login.id);
    expect(listed).toBeDefined();
    expect(listed?.passwordHash ?? '').toBe('');
    expect(JSON.stringify(accounts)).not.toContain(login.password);
  });

  it('refuses to let an admin disable their own account, in a sentence', async () => {
    const admin = await adminDevice();
    await expect(admin.services.staff.setActive(admin.actor.id, false)).rejects.toThrow(
      'You can’t disable the account you’re signed in with.',
    );
  });

  it('re-enables a disabled account', async () => {
    const admin = await adminDevice();
    const login = await newAccount('staff');
    await admin.services.staff.setActive(login.id, false);
    await admin.services.staff.setActive(login.id, true);
    const till = await device();
    expect((await till.services.staff.login(login.username, login.password)).ok).toBe(true);
  });

  it('resets a password: the new one works and the old one does not', async () => {
    const admin = await adminDevice();
    const login = await newAccount('staff');
    await admin.services.staff.resetPassword(login.id, 'a-new-password');

    const till = await device();
    expect((await till.services.staff.login(login.username, login.password)).ok).toBe(false);
    expect((await till.services.staff.login(login.username, 'a-new-password')).ok).toBe(true);
  });

  it('deletes an account, which ends its sessions', async () => {
    const admin = await adminDevice();
    const till = await signedIn('staff');
    await admin.services.staff.remove(admin.actor, till.actor.id);

    expect((await admin.services.staff.list()).some((a) => a.id === till.actor.id)).toBe(false);
    expect(await failureOf(till.services.config.get())).toBe('signed_out');
  });

  it('will not delete the signed-in account', async () => {
    const admin = await adminDevice();
    await expect(admin.services.staff.remove(admin.actor, admin.actor.id)).rejects.toThrow(
      'You can’t delete the account you’re signed in with.',
    );
  });

  it('is admin-only: a staff till cannot list or create accounts', async () => {
    const till = await signedIn('staff');
    expect(await failureOf(till.services.staff.list())).toBe('forbidden');
    expect(await failureOf(till.services.staff.create(`x-${unique()}`, 'pw-123456', 'admin'))).toBe(
      'forbidden',
    );
  });
});

describe('sign out all devices', () => {
  it('ends every staff session — the caller’s too — and moves the epoch forward', async () => {
    const admin = await adminDevice();
    const till = await signedIn('staff');
    const before = await admin.services.staff.currentSessionEpoch();

    const epoch = await admin.services.staff.revokeAllSessions();
    expect(epoch).toBeGreaterThan(before);

    expect(await failureOf(till.services.config.get())).toBe('signed_out');
    expect(await failureOf(admin.services.config.get())).toBe('signed_out');
    // Anyone may ask for the epoch; it is what a remembered till compares against.
    expect(await (await device()).services.staff.currentSessionEpoch()).toBe(epoch);
  });

  it('is admin-only', async () => {
    const till = await signedIn('staff');
    expect(await failureOf(till.services.staff.revokeAllSessions())).toBe('forbidden');
  });
});
