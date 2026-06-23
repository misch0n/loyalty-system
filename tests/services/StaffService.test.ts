import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, ADMIN } from '../helpers/freshStore';
import type { StaffService } from '../../src/services/StaffService';
import type { DataStore } from '../../src/ports/DataStore';

let staff: StaffService;
let store: DataStore;

beforeEach(() => {
  const services = freshServices();
  staff = services.staff;
  store = services.store;
});

describe('mock login', () => {
  it('signs in a seeded admin', async () => {
    const result = await staff.login('admin', 'admin');
    expect(result.ok).toBe(true);
    expect(result.actor?.role).toBe('admin');
  });

  it('rejects a wrong password', async () => {
    expect((await staff.login('admin', 'nope')).ok).toBe(false);
  });

  it('rejects a disabled account — a departed employee loses access', async () => {
    const created = await staff.create(ADMIN, 'leaver', 'pw', 'staff');
    await staff.setActive(ADMIN, created.id, false);
    expect((await staff.login('leaver', 'pw')).ok).toBe(false);
  });
});

describe('PIN sign-in', () => {
  it('signs in the seeded admin by PIN (4321)', async () => {
    const result = await staff.loginWithPin('4321');
    expect(result.ok).toBe(true);
    expect(result.actor?.username).toBe('admin');
    expect(result.actor?.role).toBe('admin');
  });

  it('signs in the seeded staff by PIN (1234)', async () => {
    const result = await staff.loginWithPin('1234');
    expect(result.ok).toBe(true);
    expect(result.actor?.username).toBe('staff');
  });

  it('rejects an unknown PIN', async () => {
    expect((await staff.loginWithPin('0000')).ok).toBe(false);
  });

  it('rejects a disabled account even with the right PIN', async () => {
    await staff.setActive(ADMIN, 'seed-staff', false);
    expect((await staff.loginWithPin('1234')).ok).toBe(false);
  });
});

describe('getStaffByPin', () => {
  it('returns the active account whose PIN matches', async () => {
    const account = await store.getStaffByPin('4321');
    expect(account?.username).toBe('admin');
  });

  it('returns null for an unknown PIN', async () => {
    expect(await store.getStaffByPin('9999')).toBeNull();
  });

  it('skips disabled accounts', async () => {
    await staff.setActive(ADMIN, 'seed-staff', false);
    expect(await store.getStaffByPin('1234')).toBeNull();
  });
});

describe('session revocation', () => {
  it('starts at epoch 0 before any revocation', async () => {
    expect(await staff.currentSessionEpoch()).toBe(0);
  });

  it('bumps the epoch and reflects it via currentSessionEpoch', async () => {
    const epoch = await staff.revokeAllSessions(ADMIN);
    expect(epoch).toBeGreaterThan(0);
    expect(await staff.currentSessionEpoch()).toBe(epoch);
  });
});

describe('account management', () => {
  it('creates an account and prevents duplicate usernames', async () => {
    await staff.create(ADMIN, 'newbie', 'pw', 'staff');
    await expect(staff.create(ADMIN, 'newbie', 'pw2', 'staff')).rejects.toThrow();
  });

  it('re-enables a disabled account', async () => {
    const created = await staff.create(ADMIN, 'rehire', 'pw', 'staff');
    await staff.setActive(ADMIN, created.id, false);
    await staff.setActive(ADMIN, created.id, true);
    expect((await staff.login('rehire', 'pw')).ok).toBe(true);
  });

  it('resets a password', async () => {
    const created = await staff.create(ADMIN, 'forgetful', 'old', 'staff');
    await staff.resetPassword(ADMIN, created.id, 'fresh');
    expect((await staff.login('forgetful', 'old')).ok).toBe(false);
    expect((await staff.login('forgetful', 'fresh')).ok).toBe(true);
  });
});
