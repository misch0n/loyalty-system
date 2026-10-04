/**
 * Server-side clamping of a `ProgramConfig` patch (BACKEND-PLAN §3-B-12).
 *
 * `ConfigService.sanitizeConfig` applies the same bounds table in the SPA
 * (`@cafe/shared/domain/config`), which is **presentation, not enforcement** —
 * it runs on the client, and a client-side rule is a suggestion. Migration 001
 * already puts CHECK bounds on the detector thresholds, so the database is the
 * backstop; this layer exists so a value out of range gets a clean 400 instead
 * of a 500 from a constraint violation.
 *
 * One field is refused outright rather than clamped: **`sessionEpoch`**.
 * Revocation is `POST /auth/logout-all`, not a number a client may set. The
 * prototype's `StaffService.revokeAllSessions` writes `Date.now()`, which
 * overflows the `integer` column — and accepting the field at all would let a
 * client *lower* the epoch and un-revoke every session it had just cancelled.
 */

import type { ProgramConfig } from '@cafe/shared/domain/models';
import {
  CONFIG_NUMERIC_FIELDS,
  REJECTED_CONFIG_FIELDS,
  clampConfigValue,
  normalizeRewardDescription,
  type ConfigNumericField,
} from '@cafe/shared/domain/config';

export { REJECTED_CONFIG_FIELDS };

export type ClampResult =
  | { ok: true; patch: Partial<ProgramConfig> }
  | { ok: false; error: 'rejected_field' | 'empty_patch' };

// The floors and ceilings live in `@cafe/shared/domain/config` (`CONFIG_BOUNDS`)
// so the SPA's Configure editor and `ConfigService.sanitizeConfig` apply the
// same ones (register A4). Every numeric field has a ceiling — an unbounded
// `pointsPerReward` would render a card grid of a million cups — and the detector
// counts floor at 2, the database's own `BETWEEN 2 AND 100`, so an admin's typo
// is saved-and-corrected rather than turned into a 500.

/**
 * Dismissals accumulate one key per acknowledged alert and are rewritten whole
 * by `LoyaltyService.dismissAlert`, so the array needs a ceiling of its own —
 * otherwise a single admin-tier call could grow the config row without bound.
 */
const DISMISSED_ALERTS_MAX = 500;
const ALERT_KEY_MAX = 200;

function clampNumber(value: unknown, field: ConfigNumericField): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clampConfigValue(field, value);
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

  for (const field of CONFIG_NUMERIC_FIELDS) {
    const clamped = clampNumber(patch[field], field);
    if (clamped !== undefined) out[field] = clamped;
  }

  if (typeof patch.rewardDescription === 'string') {
    out.rewardDescription = normalizeRewardDescription(patch.rewardDescription);
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
