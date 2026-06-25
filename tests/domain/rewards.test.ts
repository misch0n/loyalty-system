import { describe, it, expect } from 'vitest';
import {
  unspentRewards,
  cardProgress,
  mintFold,
  validateRedemption,
  isOverCap,
  planUndo,
} from '../../src/domain/rewards';
import type { ProgramConfig, Reward } from '../../src/domain/models';

const config: ProgramConfig = {
  pointsPerReward: 8,
  rewardDescription: 'Free regular coffee',
  pointsPerPurchase: 1,
  maxPointsPerTransaction: 3,
  cardInactivityDays: 0,
};

function reward(over: Partial<Reward> = {}): Reward {
  return {
    id: Math.random().toString(36),
    token: 'tok',
    shortCode: 'ABCD2345',
    ownerId: 'c1',
    status: 'unspent',
    issuedAt: '2026-01-01T00:00:00.000Z',
    sourceTxnId: 'tx1',
    descriptionSnapshot: 'Free regular coffee',
    ...over,
  };
}

describe('unspentRewards', () => {
  it('counts only unspent rewards', () => {
    const rewards = [
      reward({ status: 'unspent' }),
      reward({ status: 'unspent' }),
      reward({ status: 'spent' }),
      reward({ status: 'voided' }),
    ];
    expect(unspentRewards(rewards)).toBe(2);
  });
  it('is zero for an empty list', () => {
    expect(unspentRewards([])).toBe(0);
  });
});

describe('cardProgress', () => {
  it('reports the settled balance as current, no rewardsAvailable field', () => {
    expect(cardProgress(2, config)).toEqual({ current: 2, threshold: 8 });
  });
  it('wraps a balance that has not yet been mint-folded', () => {
    // Defensive: if handed a raw over-threshold balance, current wraps modulo.
    expect(cardProgress(10, config)).toEqual({ current: 2, threshold: 8 });
  });
  it('clamps negative balances to zero', () => {
    expect(cardProgress(-3, config)).toEqual({ current: 0, threshold: 8 });
  });
  it('degrades safely when threshold is zero', () => {
    expect(cardProgress(5, { ...config, pointsPerReward: 0 })).toEqual({ current: 5, threshold: 0 });
  });
});

describe('mintFold', () => {
  it('mints nothing below the threshold', () => {
    expect(mintFold(7, config)).toEqual({
      mintCount: 0,
      threshold: 8,
      perMintPoints: -8,
      settledBalance: 7,
    });
  });
  it('mints exactly one on crossing and settles the remainder', () => {
    expect(mintFold(8, config)).toEqual({
      mintCount: 1,
      threshold: 8,
      perMintPoints: -8,
      settledBalance: 0,
    });
    expect(mintFold(9, config)).toEqual({
      mintCount: 1,
      threshold: 8,
      perMintPoints: -8,
      settledBalance: 1,
    });
  });
  it('folds multiple rewards from a single large balance (multi-mint loop)', () => {
    expect(mintFold(20, config)).toEqual({
      mintCount: 2,
      threshold: 8,
      perMintPoints: -8,
      settledBalance: 4,
    });
  });
  it('mints nothing for a zero or negative threshold', () => {
    expect(mintFold(50, { ...config, pointsPerReward: 0 })).toMatchObject({ mintCount: 0 });
  });
});

describe('validateRedemption', () => {
  it('accepts an owned, unspent reward', () => {
    expect(validateRedemption(reward(), 'c1')).toEqual({ ok: true });
  });
  it('rejects a missing reward as reward_invalid', () => {
    expect(validateRedemption(null, 'c1')).toEqual({ ok: false, reason: 'reward_invalid' });
    expect(validateRedemption(undefined, 'c1')).toEqual({ ok: false, reason: 'reward_invalid' });
  });
  it('rejects a non-owned reward (ownership beats status)', () => {
    expect(validateRedemption(reward({ ownerId: 'other' }), 'c1')).toEqual({
      ok: false,
      reason: 'not_owner',
    });
    // Even an already-spent reward owned by someone else reports not_owner.
    expect(validateRedemption(reward({ ownerId: 'other', status: 'spent' }), 'c1')).toEqual({
      ok: false,
      reason: 'not_owner',
    });
  });
  it('rejects an already-spent reward', () => {
    expect(validateRedemption(reward({ status: 'spent' }), 'c1')).toEqual({
      ok: false,
      reason: 'already_spent',
    });
  });
  it('rejects voided / reserved-status rewards as reward_invalid', () => {
    expect(validateRedemption(reward({ status: 'voided' }), 'c1')).toEqual({
      ok: false,
      reason: 'reward_invalid',
    });
    expect(validateRedemption(reward({ status: 'transfer_pending' }), 'c1')).toEqual({
      ok: false,
      reason: 'reward_invalid',
    });
  });
});

describe('isOverCap', () => {
  it('allows 0..max (redeem-only commit is allowed)', () => {
    expect(isOverCap(0, config)).toBe(false);
    expect(isOverCap(3, config)).toBe(false);
  });
  it('rejects above the cap', () => {
    expect(isOverCap(4, config)).toBe(true);
  });
  it('rejects negative or non-integer deltas', () => {
    expect(isOverCap(-1, config)).toBe(true);
    expect(isOverCap(1.5, config)).toBe(true);
  });
});

describe('planUndo', () => {
  it('reverses a plain accrual with no mints or redeems', () => {
    expect(
      planUndo({ pointsDelta: 3, threshold: 8, mintedRewardIds: [], spentRewardIds: [] }),
    ).toEqual({ reversePoints: -3, voidRewardIds: [], reissueForSpentRewardIds: [] });
  });
  it('voids a freshly-minted reward and nets the points back to pre-commit', () => {
    // pre-balance 5, +5 → 10, mints 1 (−8), settles to 2. Undo must return to 5.
    expect(
      planUndo({ pointsDelta: 5, threshold: 8, mintedRewardIds: ['r-new'], spentRewardIds: [] }),
    ).toEqual({ reversePoints: 3, voidRewardIds: ['r-new'], reissueForSpentRewardIds: [] });
  });
  it('re-mints a replacement for each spent reward (a spent reward stays spent)', () => {
    expect(
      planUndo({
        pointsDelta: 0,
        threshold: 8,
        mintedRewardIds: [],
        spentRewardIds: ['r1', 'r2'],
      }),
    ).toEqual({ reversePoints: 0, voidRewardIds: [], reissueForSpentRewardIds: ['r1', 'r2'] });
  });
  it('handles a commit that both minted and redeemed in one step', () => {
    expect(
      planUndo({
        pointsDelta: 5,
        threshold: 8,
        mintedRewardIds: ['r-new'],
        spentRewardIds: ['r-old1', 'r-old2'],
      }),
    ).toEqual({
      reversePoints: 3,
      voidRewardIds: ['r-new'],
      reissueForSpentRewardIds: ['r-old1', 'r-old2'],
    });
  });
});
