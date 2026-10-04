/**
 * ConfigService — read the program config; admin edits it.
 *
 * `PATCH /config` clamps and audits server-side (`config/clamp.ts`); the
 * clamping here is presentation — it applies the server's own bounds table
 * before the value is sent, so what the admin sees is what will be saved — and
 * the server's answer is the config that was actually saved. A refusal comes
 * back as the `ApiError` the client threw (`services/errors.ts`); the Configure
 * editor reports it on the editor.
 */

import {
  CONFIG_NUMERIC_FIELDS,
  clampConfigValue,
  normalizeRewardDescription,
} from '@cafe/shared/domain/config';
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
 * Keep config values inside the bounds the server clamps to — the same table,
 * `CONFIG_BOUNDS` in `@cafe/shared/domain/config` (register A4) — and the
 * reward text non-blank. Only the fields sent are touched, so a patch never
 * resets a field nobody mentioned.
 *
 * `sessionEpoch` is not passed through: the server refuses it by name, because
 * revocation is `POST /auth/logout-all` (`StaffService.revokeAllSessions`).
 */
export function sanitizeConfig(patch: Partial<ProgramConfig>): Partial<ProgramConfig> {
  const out: Partial<ProgramConfig> = {};
  for (const field of CONFIG_NUMERIC_FIELDS) {
    const value = patch[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[field] = clampConfigValue(field, value);
    }
  }
  if (patch.rewardDescription !== undefined)
    out.rewardDescription = normalizeRewardDescription(patch.rewardDescription);
  return out;
}
