import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, STAFF, ADMIN } from '../helpers/freshStore';
import type { AuditService } from '../../src/services/AuditService';

let audit: AuditService;

beforeEach(() => {
  audit = freshServices().audit;
});

describe('log', () => {
  it('records actor id/role, action, target and details', async () => {
    await audit.log(STAFF, 'loyalty.accrue', 'cust-1', '+3');
    const [entry] = await audit.list();
    expect(entry.actorId).toBe(STAFF.id);
    expect(entry.actorRole).toBe('staff');
    expect(entry.action).toBe('loyalty.accrue');
    expect(entry.targetId).toBe('cust-1');
    expect(entry.details).toBe('+3');
    expect(entry.timestamp).toBeTruthy();
  });

  it('accepts a system actor (e.g. failed login) with no target', async () => {
    await audit.log({ id: 'unknown', role: 'system' }, 'staff.login.failed');
    const [entry] = await audit.list();
    expect(entry.actorRole).toBe('system');
    expect(entry.targetId).toBeUndefined();
  });
});

describe('list', () => {
  beforeEach(async () => {
    await audit.log(ADMIN, 'config.update', undefined, 'pointsPerReward');
    await audit.log(STAFF, 'loyalty.accrue', 'c1', '+1');
    await audit.log(STAFF, 'loyalty.redeem', 'c1');
  });

  it('filters by action', async () => {
    const rows = await audit.list({ action: 'loyalty.accrue' });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('loyalty.accrue');
  });

  it('filters by actorId', async () => {
    const rows = await audit.list({ actorId: STAFF.id });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actorId === STAFF.id)).toBe(true);
  });

  it('honours the limit', async () => {
    expect(await audit.list({ limit: 2 })).toHaveLength(2);
  });

  it('returns everything with no filter', async () => {
    expect(await audit.list()).toHaveLength(3);
  });
});
