/**
 * Program-config bounds — the one table of floors and ceilings (register A4).
 *
 * Two places apply it: the server's `config/clamp.ts`, which is the
 * enforcement, and the SPA's `ConfigService.sanitizeConfig` plus the Configure
 * editor, which are presentation — they keep a value the admin can see inside
 * the range the server would clamp it to anyway, so what is shown is what is
 * saved. Before this table the client only floored, and floored the detector
 * counts at 1 where the server floors at 2; one table keeps them from drifting
 * again.
 *
 * Every numeric field has a ceiling. The client never needed one while its
 * inputs were spinners a person drives, but over HTTP a value arrives from
 * whatever chose to send it, and an unbounded `pointsPerReward` would render a
 * card grid of a million cups. The bounds sit inside migration 001's CHECK
 * constraints, so a value the database would refuse is clamped first.
 *
 * Pure: no I/O. `sessionEpoch` is not here because it is not a setting —
 * revocation is `POST /auth/logout-all`, and the server refuses the field by
 * name (`REJECTED_CONFIG_FIELDS`).
 */

import type { ProgramConfig } from './models.js';

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

export const CONFIG_BOUNDS = {
  pointsPerReward: { min: 1, max: 100 },
  pointsPerPurchase: { min: 1, max: 100 },
  maxPointsPerTransaction: { min: 1, max: 100 },
  // The one field where 0 is meaningful: it disables the retention policy.
  cardInactivityDays: { min: 0, max: 3650 },
  selfDealWindowSec: { min: 1, max: 3600 },
  // Floor 2, not 1. A count of 1 flags on the very first occurrence of an
  // entirely ordinary pattern (a customer who qualifies on this purchase and
  // takes the free coffee straight away), so `alerts.ts` needs the *repeated*
  // pattern to mean anything. The database enforces `BETWEEN 2 AND 100`.
  selfDealCount: { min: 2, max: 100 },
  repeatCount: { min: 2, max: 100 },
  repeatWindowMin: { min: 1, max: 1440 },
} as const satisfies Record<string, Bounds>;

/** The numeric `ProgramConfig` fields a patch may set. */
export type ConfigNumericField = keyof typeof CONFIG_BOUNDS;

/** Every bounded field, in table order. */
export const CONFIG_NUMERIC_FIELDS = Object.keys(CONFIG_BOUNDS) as ConfigNumericField[];

/** Fields a config patch may never carry, whatever their value. */
export const REJECTED_CONFIG_FIELDS = ['sessionEpoch'] as const satisfies readonly (keyof ProgramConfig)[];

/** Longest reward description the server keeps; longer text is cut. */
export const REWARD_DESCRIPTION_MAX = 120;

/** What a blank reward description becomes. */
export const DEFAULT_REWARD_DESCRIPTION = 'Free regular coffee';

/** Clamp a value to a field's bounds, as a whole number. */
export function clampConfigValue(field: ConfigNumericField, value: number): number {
  const { min, max } = CONFIG_BOUNDS[field];
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** True when `value` is a whole number inside the field's bounds. */
export function isWithinBounds(field: ConfigNumericField, value: number): boolean {
  const { min, max } = CONFIG_BOUNDS[field];
  return Number.isInteger(value) && value >= min && value <= max;
}

/** The reward description as it will be stored: trimmed, capped, never blank. */
export function normalizeRewardDescription(text: string): string {
  return text.trim().slice(0, REWARD_DESCRIPTION_MAX) || DEFAULT_REWARD_DESCRIPTION;
}
