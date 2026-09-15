/**
 * Server-side clamping of a `ProgramConfig` patch (BACKEND-PLAN §3-B-12).
 *
 * `ConfigService.sanitizeConfig` does the same arithmetic in the SPA, which is
 * **presentation, not enforcement** — it runs on the client, and a client-side
 * rule is a suggestion. Migration 001 already puts CHECK bounds on the detector
 * thresholds, so the database is the backstop; this layer exists so a value out
 * of range gets a clean 400 instead of a 500 from a constraint violation.
 *
 * One field is refused outright rather than clamped: **`sessionEpoch`**.
 * Revocation is `POST /auth/logout-all`, not a number a client may set. The
 * prototype's `StaffService.revokeAllSessions` writes `Date.now()`, which
 * overflows the `integer` column — and accepting the field at all would let a
 * client *lower* the epoch and un-revoke every session it had just cancelled.
 */

import type { ProgramConfig } from '@cafe/shared/domain/models';

/** Fields a config patch may never carry, whatever their value. */
export const REJECTED_CONFIG_FIELDS = ['sessionEpoch'] as const;

export type ClampResult =
  | { ok: true; patch: Partial<ProgramConfig> }
  | { ok: false; error: 'rejected_field' | 'empty_patch' };

/**
 * Upper bounds, which `sanitizeConfig` has none of.
 *
 * The client only ever needed a floor because its inputs are number spinners a
 * person drives. Over HTTP the value arrives from whatever chose to send it, and
 * an unbounded `pointsPerReward` would render a card grid of a million cups — so
 * every numeric field gets a ceiling that is generous for a café and finite for
 * a caller that is not one. They sit inside migration 001's CHECK bounds, so
 * this layer answers where the database would otherwise throw.
 */
const BOUNDS = {
  pointsPerReward: { min: 1, max: 100 },
  pointsPerPurchase: { min: 1, max: 100 },
  maxPointsPerTransaction: { min: 1, max: 100 },
  // The one field where 0 is meaningful: it disables the retention policy.
  cardInactivityDays: { min: 0, max: 3650 },
  selfDealWindowSec: { min: 1, max: 3600 },
  // Floor 2, not `sanitizeConfig`'s 1 — a deliberate divergence, and the one
  // place migration 001 is stricter than the client. A count of 1 flags on the
  // very first occurrence of an entirely ordinary pattern (a customer who
  // qualifies on this purchase and takes the free coffee straight away), so
  // `domain/alerts.ts` needs the *repeated* pattern to mean anything. The
  // database enforces `BETWEEN 2 AND 100`; clamping to 1 here would turn an
  // admin's typo into a 500 instead of a saved-and-corrected value.
  selfDealCount: { min: 2, max: 100 },
  repeatCount: { min: 2, max: 100 },
  repeatWindowMin: { min: 1, max: 1440 },
} as const;

type NumericField = keyof typeof BOUNDS;

const REWARD_DESCRIPTION_MAX = 120;
/**
 * Dismissals accumulate one key per acknowledged alert and are rewritten whole
 * by `LoyaltyService.dismissAlert`, so the array needs a ceiling of its own —
 * otherwise a single admin-tier call could grow the config row without bound.
 */
const DISMISSED_ALERTS_MAX = 500;
const ALERT_KEY_MAX = 200;

function clampNumber(value: unknown, field: NumericField): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const { min, max } = BOUNDS[field];
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Clamps the fields present and drops the rest, mirroring `sanitizeConfig`'s
 * "apply only what was sent" shape so a patch never resets a field nobody
 * mentioned.
 */
export function clampConfigPatch(patch: Record<string, unknown>): ClampResult {
  for (const field of REJECTED_CONFIG_FIELDS) {
    if (field in patch) return { ok: false, error: 'rejected_field' };
  }

  const out: Partial<ProgramConfig> = {};

  const fields = Object.keys(BOUNDS) as NumericField[];
  for (const field of fields) {
    const clamped = clampNumber(patch[field], field);
    if (clamped !== undefined) out[field] = clamped;
  }

  if (typeof patch.rewardDescription === 'string') {
    out.rewardDescription =
      patch.rewardDescription.trim().slice(0, REWARD_DESCRIPTION_MAX) || 'Free regular coffee';
  }

  // Alert acknowledgements (Appendix E). Admin-tier only, and the keys are
  // content-derived — dismissing an alert that has not happened would mean
  // guessing its key — so the array is accepted rather than given its own route.
  if (Array.isArray(patch.dismissedAlerts)) {
    out.dismissedAlerts = patch.dismissedAlerts
      .filter((key): key is string => typeof key === 'string')
      .map((key) => key.slice(0, ALERT_KEY_MAX))
      .slice(0, DISMISSED_ALERTS_MAX);
  }

  if (Object.keys(out).length === 0) return { ok: false, error: 'empty_patch' };
  return { ok: true, patch: out };
}
