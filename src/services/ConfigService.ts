/**
 * ConfigService — read the program config; admin edits it (logged).
 */

import type { ProgramConfig } from '../domain/models';
import type { DataStore } from '../ports/DataStore';
import type { AuditService } from './AuditService';
import type { Actor } from './types';

export class ConfigService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditService,
  ) {}

  get(): Promise<ProgramConfig> {
    return this.store.getConfig();
  }

  async update(actor: Actor, patch: Partial<ProgramConfig>): Promise<ProgramConfig> {
    const sanitized = sanitizeConfig(patch);
    const config = await this.store.updateConfig(sanitized);
    await this.audit.log(actor, 'config.update', undefined, Object.keys(sanitized).join(','));
    return config;
  }
}

/** Keep config values sane (positive integers, non-empty reward text). */
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
  return out;
}
