import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, STAFF, ADMIN } from '../helpers/freshStore';
import { parseExportRecord, type AuditService } from '../../src/services/AuditService';

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

describe('exportActivity (Appendix E investigation workflow)', () => {
  it('returns the filtered rows and writes an audit.export row carrying the reason', async () => {
    await audit.log(STAFF, 'loyalty.accrue', 'c1', '+1');
    await audit.log(STAFF, 'loyalty.redeem', 'c1');
    await audit.log(ADMIN, 'config.update');

    const rows = await audit.exportActivity(
      ADMIN,
      { actions: ['loyalty.accrue', 'loyalty.redeem'] },
      'checking a disputed reward',
    );
    expect(rows).toHaveLength(2);

    // The export is itself an audited event, attributed to the admin who ran it.
    const exports = await audit.list({ action: 'audit.export' });
    expect(exports).toHaveLength(1);
    expect(exports[0].actorId).toBe(ADMIN.id);

    const record = parseExportRecord(exports[0].details);
    expect(record?.reason).toBe('checking a disputed reward');
    expect(record?.count).toBe(2);
    expect(record?.actions).toEqual(['loyalty.accrue', 'loyalty.redeem']);
  });

  it('includes admins in an account-scoped export — no role exemption', async () => {
    await audit.log(ADMIN, 'loyalty.accrue', 'c1', '+1');
    await audit.log(STAFF, 'loyalty.accrue', 'c1', '+1');

    const rows = await audit.exportActivity(ADMIN, { actorIds: [ADMIN.id] }, 'spot check');
    expect(rows.every((r) => r.actorId === ADMIN.id)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('refuses to run without a reason, and writes nothing', async () => {
    await audit.log(STAFF, 'loyalty.accrue', 'c1', '+1');
    await expect(audit.exportActivity(ADMIN, {}, '   ')).rejects.toThrow(/reason/i);
    expect(await audit.list({ action: 'audit.export' })).toHaveLength(0);
  });

  it('records a re-run as a new export, never a silent replay', async () => {
    await audit.log(STAFF, 'loyalty.accrue', 'c1', '+1');
    await audit.exportActivity(ADMIN, { actions: ['loyalty.accrue'] }, 'first look');
    const first = await audit.list({ action: 'audit.export' });
    const record = parseExportRecord(first[0].details);

    await audit.exportActivity(
      ADMIN,
      { actions: record?.actions },
      `Re-run: ${record?.reason}`,
    );
    // Two rows, both audited. Don't assert on their relative order — they can
    // land in the same millisecond, and listAudit sorts by timestamp only.
    const both = await audit.list({ action: 'audit.export' });
    expect(both).toHaveLength(2);
    const reasons = both.map((e) => parseExportRecord(e.details)?.reason);
    expect(reasons).toContain('first look');
    expect(reasons).toContain('Re-run: first look');
  });
});
