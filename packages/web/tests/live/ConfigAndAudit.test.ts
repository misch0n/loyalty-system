/**
 * ConfigService and AuditService against the real server.
 *
 * Neither service writes an audit row any more (register P7): the routes do,
 * from the session. So the claims worth checking are that each action leaves
 * exactly one row, attributed to the signed-in account, and that a till reads
 * only its own.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProgramConfig } from '@cafe/shared/domain/models';
import { isApiError } from '../../src/services/errors';
import { adminDevice, customerPhone, signedIn } from './harness';

let original: ProgramConfig;

beforeAll(async () => {
  original = await (await adminDevice()).services.config.get();
});

afterAll(async () => {
  const admin = await adminDevice();
  await admin.services.config.update({
    pointsPerReward: original.pointsPerReward,
    rewardDescription: original.rewardDescription,
    repeatCount: original.repeatCount ?? 3,
  });
});

describe('ConfigService', () => {
  it('lets staff read the config the counter needs', async () => {
    const till = await signedIn('staff');
    const config = await till.services.config.get();
    expect(config.pointsPerReward).toBeGreaterThan(0);
    expect(config.maxPointsPerTransaction).toBeGreaterThan(0);
  });

  it('saves an admin’s change and answers with what was saved', async () => {
    const admin = await adminDevice();
    const saved = await admin.services.config.update({ pointsPerReward: 7, rewardDescription: '  ' });
    expect(saved.pointsPerReward).toBe(7);
    // Blank reward text is presentation-sanitised before it is sent.
    expect(saved.rewardDescription).toBe('Free regular coffee');
    expect((await admin.services.config.get()).pointsPerReward).toBe(7);
  });

  it('is clamped by the server where the client floor is lower', async () => {
    // The client floors a count at 1; the server's floor is 2 (config/clamp.ts).
    const admin = await adminDevice();
    expect((await admin.services.config.update({ repeatCount: 1 })).repeatCount).toBe(2);
  });

  it('never sends the session epoch — revocation is its own route', async () => {
    const admin = await adminDevice();
    // Sent as-is, the server would refuse the whole patch (`rejected_field`).
    const saved = await admin.services.config.update({ sessionEpoch: 0, pointsPerReward: 8 });
    expect(saved.pointsPerReward).toBe(8);
  });

  it('is admin-only to change', async () => {
    const till = await signedIn('staff');
    const failure = await till.services.config.update({ pointsPerReward: 2 }).then(
      () => null,
      (err: unknown) => (isApiError(err) ? err.failure.kind : null),
    );
    expect(failure).toBe('forbidden');
  });
});

describe('AuditService', () => {
  it('shows a till exactly one row per action, attributed to its own account', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    await till.services.loyalty.commit(till.actor, {
      customerId: phone.customer.id,
      pointsDelta: 1,
      redeemRewardIds: [],
      idempotencyKey: randomUUID(),
      source: 'a',
    });

    const rows = await till.services.audit.list({ action: 'loyalty.accrue' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: till.actor.id, targetId: phone.customer.id });
  });

  it('never shows a till another account’s rows, whatever filter it sends', async () => {
    const phone = await customerPhone();
    const busy = await signedIn('staff');
    await busy.services.loyalty.commit(busy.actor, {
      customerId: phone.customer.id,
      pointsDelta: 1,
      redeemRewardIds: [],
      idempotencyKey: randomUUID(),
      source: 'a',
    });

    const nosy = await signedIn('staff');
    const rows = await nosy.services.audit.list({ actorId: busy.actor.id });
    expect(rows.every((row) => row.actorId === nosy.actor.id)).toBe(true);
    expect(rows.some((row) => row.action === 'loyalty.accrue')).toBe(false);
  });

  it('records sign-in on the server, not from the client', async () => {
    const till = await signedIn('staff');
    const rows = await till.services.audit.list({ action: 'staff.login' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(till.actor.id);
  });
});
