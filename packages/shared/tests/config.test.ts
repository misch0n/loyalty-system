import { describe, it, expect } from 'vitest';
import {
  CONFIG_BOUNDS,
  CONFIG_NUMERIC_FIELDS,
  REJECTED_CONFIG_FIELDS,
  REWARD_DESCRIPTION_MAX,
  clampConfigValue,
  isWithinBounds,
  normalizeRewardDescription,
} from '../src/domain/config.js';

describe('CONFIG_BOUNDS', () => {
  it('bounds every numeric setting, above and below', () => {
    expect(CONFIG_NUMERIC_FIELDS).toEqual([
      'pointsPerReward',
      'pointsPerPurchase',
      'maxPointsPerTransaction',
      'cardInactivityDays',
      'selfDealWindowSec',
      'selfDealCount',
      'repeatCount',
      'repeatWindowMin',
    ]);
    for (const field of CONFIG_NUMERIC_FIELDS) {
      const { min, max } = CONFIG_BOUNDS[field];
      expect(Number.isInteger(min)).toBe(true);
      expect(Number.isInteger(max)).toBe(true);
      expect(max).toBeGreaterThan(min);
    }
  });

  it('floors the detector counts at 2, as the database does', () => {
    expect(CONFIG_BOUNDS.selfDealCount.min).toBe(2);
    expect(CONFIG_BOUNDS.repeatCount.min).toBe(2);
  });

  it('lets the retention policy be switched off with 0', () => {
    expect(CONFIG_BOUNDS.cardInactivityDays.min).toBe(0);
  });

  it('never lets a patch carry the session epoch', () => {
    expect(REJECTED_CONFIG_FIELDS).toContain('sessionEpoch');
    expect(CONFIG_NUMERIC_FIELDS).not.toContain('sessionEpoch');
  });
});

describe('clampConfigValue', () => {
  it('raises a value below the floor to the floor', () => {
    expect(clampConfigValue('repeatCount', 1)).toBe(2);
    expect(clampConfigValue('pointsPerReward', 0)).toBe(1);
    expect(clampConfigValue('cardInactivityDays', -5)).toBe(0);
  });

  it('lowers a value above the ceiling to the ceiling', () => {
    expect(clampConfigValue('pointsPerReward', 1_000_000)).toBe(100);
    expect(clampConfigValue('repeatWindowMin', 99_999)).toBe(1440);
  });

  it('drops the fraction', () => {
    expect(clampConfigValue('pointsPerReward', 9.9)).toBe(9);
  });

  it('leaves an in-range whole number alone', () => {
    expect(clampConfigValue('selfDealWindowSec', 30)).toBe(30);
  });
});

describe('isWithinBounds', () => {
  it('accepts the edges and refuses past them', () => {
    expect(isWithinBounds('selfDealCount', 2)).toBe(true);
    expect(isWithinBounds('selfDealCount', 100)).toBe(true);
    expect(isWithinBounds('selfDealCount', 1)).toBe(false);
    expect(isWithinBounds('selfDealCount', 101)).toBe(false);
  });

  it('refuses a fraction', () => {
    expect(isWithinBounds('pointsPerReward', 9.5)).toBe(false);
  });
});

describe('normalizeRewardDescription', () => {
  it('trims, and replaces blank text with the default', () => {
    expect(normalizeRewardDescription('  Free flat white  ')).toBe('Free flat white');
    expect(normalizeRewardDescription('   ')).toBe('Free regular coffee');
  });

  it('cuts text past the cap', () => {
    expect(normalizeRewardDescription('x'.repeat(500))).toHaveLength(REWARD_DESCRIPTION_MAX);
  });
});
