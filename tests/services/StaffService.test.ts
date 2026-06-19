import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, ADMIN } from '../helpers/freshStore';
import type { StaffService } from '../../src/services/StaffService';

let staff: StaffService;

beforeEach(() => {
  staff = freshServices().staff;
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
