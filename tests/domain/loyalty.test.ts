import { describe, it, expect } from 'vitest';
import {
  balance,
  rewardAvailable,
  progress,
  clampAccrual,
  isValidAccrual,
  checkRedemption,
} from '../../src/domain/loyalty';
import type { LoyaltyTransaction, ProgramConfig } from '../../src/domain/models';

const config: ProgramConfig = {
  pointsPerReward: 9,
  rewardDescription: 'Free regular coffee',
  pointsPerPurchase: 1,
  maxPointsPerTransaction: 3,
  cardInactivityDays: 0,
};

function tx(points: number, type: LoyaltyTransaction['type'] = 'accrual'): LoyaltyTransaction {
  return {
    id: Math.random().toString(36),
    customerId: 'c1',
    type,
    points,
    staffId: 's1',
    timestamp: new Date().toISOString(),
  };
}

describe('balance', () => {
  it('sums the signed ledger', () => {
    expect(balance([tx(3), tx(3), tx(-9, 'redemption'), tx(3)])).toBe(0);
  });
  it('is zero for an empty ledger', () => {
    expect(balance([])).toBe(0);
  });
});

describe('rewardAvailable', () => {
  it('is true at the threshold', () => {
    expect(rewardAvailable(9, config)).toBe(true);
  });
  it('is false below the threshold', () => {
    expect(rewardAvailable(8, config)).toBe(false);
  });
});

describe('progress', () => {
  it('reports current-of-threshold and rewards ready', () => {
    expect(progress(10, config)).toEqual({ current: 1, threshold: 9, rewardsAvailable: 1 });
  });
  it('clamps negative balances to zero', () => {
    expect(progress(-5, config)).toEqual({ current: 0, threshold: 9, rewardsAvailable: 0 });
  });
});

describe('clampAccrual / isValidAccrual', () => {
  it('caps at maxPointsPerTransaction', () => {
    expect(clampAccrual(10, config)).toBe(3);
  });
  it('floors at 1 for invalid input', () => {
    expect(clampAccrual(0, config)).toBe(1);
    expect(clampAccrual(-4, config)).toBe(1);
    expect(clampAccrual(Number.NaN, config)).toBe(1);
  });
  it('validates within range', () => {
    expect(isValidAccrual(3, config)).toBe(true);
    expect(isValidAccrual(4, config)).toBe(false);
    expect(isValidAccrual(0, config)).toBe(false);
  });
});

describe('checkRedemption', () => {
  it('approves with a negative threshold delta when eligible', () => {
    expect(checkRedemption(9, config)).toEqual({ ok: true, delta: -9 });
  });
  it('rejects when below the threshold', () => {
    const result = checkRedemption(5, config);
    expect(result.ok).toBe(false);
    expect(result.delta).toBe(0);
    expect(result.reason).toContain('Not enough points');
  });
});
