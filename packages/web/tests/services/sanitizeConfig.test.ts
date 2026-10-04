/**
 * `ConfigService.sanitizeConfig` — the presentation half of register A4. Pure,
 * so no store: it is checked against the shared bounds table the server clamps
 * with, which is what keeps the two from drifting.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG_BOUNDS, CONFIG_NUMERIC_FIELDS } from '@cafe/shared/domain/config';
import { sanitizeConfig } from '../../src/services/ConfigService';

describe('sanitizeConfig', () => {
  it('clamps every numeric field to the server’s floor and ceiling', () => {
    for (const field of CONFIG_NUMERIC_FIELDS) {
      const { min, max } = CONFIG_BOUNDS[field];
      expect(sanitizeConfig({ [field]: min - 1 })[field]).toBe(min);
      expect(sanitizeConfig({ [field]: max + 1 })[field]).toBe(max);
    }
  });

  it('floors the detector counts at 2, as the server does', () => {
    expect(sanitizeConfig({ selfDealCount: 1, repeatCount: 1 })).toEqual({
      selfDealCount: 2,
      repeatCount: 2,
    });
  });

  it('touches only the fields that were sent', () => {
    expect(sanitizeConfig({ pointsPerReward: 9 })).toEqual({ pointsPerReward: 9 });
  });

  it('never sends the session epoch', () => {
    expect(sanitizeConfig({ sessionEpoch: 4, pointsPerReward: 9 })).toEqual({ pointsPerReward: 9 });
  });

  it('replaces blank reward text with the default', () => {
    expect(sanitizeConfig({ rewardDescription: '   ' })).toEqual({
      rewardDescription: 'Free regular coffee',
    });
  });
});
