/**
 * ConfigService — read the program config; admin edits it.
 *
 * `PATCH /config` clamps and audits server-side (`config/clamp.ts`); the
 * arithmetic here is presentation — it keeps a spinner's value sensible before
 * it is sent — and the server's answer is the config that was actually saved.
 */

import type { ProgramConfig } from '@cafe/shared/domain/models';
import type { DataStore } from '@cafe/shared/ports/DataStore';

export class ConfigService {
  constructor(private readonly store: DataStore) {}

  get(): Promise<ProgramConfig> {
    return this.store.getConfig();
  }

  update(patch: Partial<ProgramConfig>): Promise<ProgramConfig> {
    return this.store.updateConfig(sanitizeConfig(patch));
  }
}

/**
 * Keep config values sane (positive integers, non-empty reward text).
 *
 * `sessionEpoch` is not passed through: the server refuses it by name, because
 * revocation is `POST /auth/logout-all` (`StaffService.revokeAllSessions`).
 */
function sanitizeConfig(patch: Partial<ProgramConfig>): Partial<ProgramConfig> {
  const out: Partial<ProgramConfig> = {};
  if (patch.pointsPerReward !== undefined)
    out.pointsPerReward = Math.max(1, Math.floor(patch.pointsPerReward));
  if (patch.pointsPerPurchase !== undefined)
    out.pointsPerPurchase = Math.max(1, Math.floor(patch.pointsPerPurchase));
  if (patch.maxPointsPerTransaction !== undefined)
    out.maxPointsPerTransaction = Math.max(1, Math.floor(patch.maxPointsPerTransaction));
  if (patch.cardInactivityDays !== undefined)
    out.cardInactivityDays = Math.max(0, Math.floor(patch.cardInactivityDays));
  if (patch.rewardDescription !== undefined)
    out.rewardDescription = patch.rewardDescription.trim() || 'Free regular coffee';
  // Detector thresholds (Appendix E). All are positive whole numbers; a count of
  // 0 would flag on every single action, so the floor is 1.
  if (patch.selfDealWindowSec !== undefined)
    out.selfDealWindowSec = Math.max(1, Math.floor(patch.selfDealWindowSec));
  if (patch.selfDealCount !== undefined)
    out.selfDealCount = Math.max(1, Math.floor(patch.selfDealCount));
  if (patch.repeatCount !== undefined)
    out.repeatCount = Math.max(1, Math.floor(patch.repeatCount));
  if (patch.repeatWindowMin !== undefined)
    out.repeatWindowMin = Math.max(1, Math.floor(patch.repeatWindowMin));
  return out;
}
