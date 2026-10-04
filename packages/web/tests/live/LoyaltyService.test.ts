/**
 * LoyaltyService against the real server: the counter commit (accrue, mint on
 * crossing, redeem — atomic and idempotent), the derived card state, the
 * correction path, and the admin's alerts.
 *
 * The program config is global, so this file pins the numbers it relies on and
 * puts the originals back afterwards.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alertKey } from '@cafe/shared/domain/alerts';
import type { ProgramConfig } from '@cafe/shared/domain/models';
import { isApiError } from '../../src/services/errors';
import type { CommitInput } from '../../src/services/LoyaltyService';
import { adminDevice, customerPhone, mailCount, signedIn } from './harness';

let original: ProgramConfig;

beforeAll(async () => {
  const admin = await adminDevice();
  original = await admin.services.config.get();
  await admin.services.config.update({
    pointsPerReward: 3,
    maxPointsPerTransaction: 3,
    selfDealCount: 2,
    selfDealWindowSec: 3600,
  });
});

afterAll(async () => {
  const admin = await adminDevice();
  await admin.services.config.update({
    pointsPerReward: original.pointsPerReward,
    maxPointsPerTransaction: original.maxPointsPerTransaction,
    selfDealCount: original.selfDealCount ?? 3,
    selfDealWindowSec: original.selfDealWindowSec ?? 30,
  });
});

function commitOf(customerId: string, patch: Partial<CommitInput> = {}): CommitInput {
  return {
    customerId,
    pointsDelta: 0,
    redeemRewardIds: [],
    idempotencyKey: randomUUID(),
    source: 'a',
    ...patch,
  };
}

async function failureKind(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (err) {
    return isApiError(err) ? err.failure.kind : 'not an ApiError';
  }
  throw new Error('expected the call to fail');
}

describe('reading a card', () => {
  it('gives the till and the card’s own phone the same derived state', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');

    const fromTill = await till.services.loyalty.getStateByToken(phone.customer.token);
    const fromPhone = await phone.services.loyalty.getStateByToken(phone.customer.token);
    expect(fromTill?.customer.id).toBe(phone.customer.id);
    expect(fromPhone).toEqual(fromTill);
    expect(fromPhone).toMatchObject({ balance: 0, rewards: [] });
    expect(fromPhone?.config.pointsPerReward).toBe(3);
  });

  it('resolves by id and by short code for the till', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    expect((await till.services.loyalty.getStateById(phone.customer.id))?.customer.id).toBe(
      phone.customer.id,
    );
    const byCode = await till.services.loyalty.getStateByShortCode(phone.customer.shortCode!);
    expect(byCode?.customer.id).toBe(phone.customer.id);
  });

  it('answers null for a card that is not there', async () => {
    const till = await signedIn('staff');
    expect(await till.services.loyalty.getStateByToken('Z'.repeat(22))).toBeNull();
    expect(await till.services.loyalty.getStateById(randomUUID())).toBeNull();
    expect(await till.services.loyalty.getStateByShortCode('ZZZZ-ZZZZ')).toBeNull();
  });
});

describe('the counter commit', () => {
  it('accrues, and mints a reward when the balance crosses the threshold', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const mailsBefore = await mailCount(phone.email);

    const first = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { pointsDelta: 2 }));
    expect(first).toMatchObject({ ok: true, minted: [], replayed: false });

    const second = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { pointsDelta: 2 }));
    if (!second.ok) throw new Error(second.error);
    expect(second.minted).toHaveLength(1);
    expect(second.state.balance).toBe(1);

    // The card's own phone sees the reward; the server sent the mail — once.
    const state = await phone.services.loyalty.getState(phone.customer.id);
    expect(state.rewards).toHaveLength(1);
    await expect.poll(() => mailCount(phone.email)).toBe(mailsBefore + 1);
  });

  it('redeems a reward, and refuses to spend it twice', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const minted = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { pointsDelta: 3 }));
    if (!minted.ok) throw new Error(minted.error);
    const rewardId = minted.minted[0]!.id;

    const spent = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { redeemRewardIds: [rewardId] }));
    expect(spent).toMatchObject({ ok: true, rejected: [] });
    if (spent.ok) expect(spent.redeemed.map((r) => r.id)).toEqual([rewardId]);

    const again = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { redeemRewardIds: [rewardId] }));
    expect(again).toMatchObject({ ok: true, redeemed: [], rejected: [{ rewardId, reason: 'already_spent' }] });
  });

  it('is idempotent: a retry with the same key writes nothing new', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const input = commitOf(phone.customer.id, { pointsDelta: 1 });

    const first = await till.services.loyalty.commit(till.actor, input);
    const retry = await till.services.loyalty.commit(till.actor, input);
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(retry).toMatchObject({ ok: true, replayed: true });
    expect((await till.services.loyalty.getState(phone.customer.id)).balance).toBe(1);
  });

  it('returns over_cap and customer_not_found as values, writing nothing', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');

    expect(await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { pointsDelta: 4 }))).toEqual({
      ok: false,
      error: 'over_cap',
    });
    expect(await till.services.loyalty.commit(till.actor, commitOf(randomUUID(), { pointsDelta: 1 }))).toEqual({
      ok: false,
      error: 'customer_not_found',
    });
    expect((await till.services.loyalty.getState(phone.customer.id)).balance).toBe(0);
  });

  it('cannot be made from a customer’s phone — staff initiate the credit', async () => {
    const phone = await customerPhone();
    const forged = { id: 'anyone', username: 'anyone', role: 'staff' as const };
    expect(
      await failureKind(phone.services.loyalty.commit(forged, commitOf(phone.customer.id, { pointsDelta: 1 }))),
    ).toBe('signed_out');
  });
});

describe('corrections', () => {
  it('reverses an accrual with a negating entry', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const committed = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { pointsDelta: 2 }));
    if (!committed.ok) throw new Error(committed.error);
    const accrual = committed.state.transactions.find((t) => t.type === 'accrual')!;

    const reversal = await till.services.loyalty.reverse(till.actor, phone.customer.id, accrual.id, 'wrong card');
    expect(reversal).toMatchObject({ type: 'reversal', points: -2, reversesTransactionId: accrual.id });
    expect((await till.services.loyalty.getState(phone.customer.id)).balance).toBe(0);
  });

  it('will not reverse the same entry twice, or a reversal', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const committed = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { pointsDelta: 1 }));
    if (!committed.ok) throw new Error(committed.error);
    const accrual = committed.state.transactions.find((t) => t.type === 'accrual')!;
    const reversal = await till.services.loyalty.reverse(till.actor, phone.customer.id, accrual.id);

    await expect(till.services.loyalty.reverse(till.actor, phone.customer.id, accrual.id)).rejects.toThrow(
      'That entry has already been reversed.',
    );
    await expect(till.services.loyalty.reverse(till.actor, phone.customer.id, reversal.id)).rejects.toThrow(
      'A reversal cannot be reversed.',
    );
  });
});

describe('alerts (admin)', () => {
  it('flags self-dealing from the audit rows the routes wrote, and forgets a dismissed one', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    // Twice: credit to a reward, then redeem it straight away — the same account, the same card.
    for (let i = 0; i < 2; i += 1) {
      const minted = await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { pointsDelta: 3 }));
      if (!minted.ok) throw new Error(minted.error);
      await till.services.loyalty.commit(till.actor, commitOf(phone.customer.id, { redeemRewardIds: [minted.minted[0]!.id] }));
    }

    const admin = await adminDevice();
    const mine = (await admin.services.loyalty.getAlerts()).filter((a) => a.staffId === till.actor.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'self-dealing', customerId: phone.customer.id, staffName: 'Test staff' });

    await admin.services.loyalty.dismissAlert(alertKey(mine[0]!));
    await admin.services.loyalty.dismissAlert(alertKey(mine[0]!)); // idempotent
    const after = await admin.services.loyalty.getAlerts();
    expect(after.some((a) => a.staffId === till.actor.id)).toBe(false);
    const dismissed = (await admin.services.config.get()).dismissedAlerts ?? [];
    expect(dismissed.filter((k) => k === alertKey(mine[0]!))).toHaveLength(1);
  });

  it('keeps alerts from staff', async () => {
    const till = await signedIn('staff');
    expect(await failureKind(till.services.loyalty.getAlerts())).toBe('forbidden');
  });
});
