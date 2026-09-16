/**
 * AuditService — writes the append-only action trail.
 *
 * Every staff/admin action funnels a record through here. `details` must never
 * contain PII (name/email/phone); pass ids and neutral context only.
 *
 * The admin activity export went with the Export sheet (UI-0, SCOPE-DECISIONS §1
 * BE-A-12): the server has no cross-account activity endpoint to export from,
 * and refuses to write an `audit.export` row at all.
 */

import type { AuditAction } from '@cafe/shared/domain/models';
import type { AuditFilter, DataStore } from '@cafe/shared/ports/DataStore';
import type { Actor } from './types';

export class AuditService {
  constructor(private readonly store: DataStore) {}

  log(
    actor: Pick<Actor, 'id' | 'role'> | { id: string; role: 'system' },
    action: AuditAction,
    targetId?: string,
    details?: string,
  ): Promise<void> {
    return this.store.appendAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action,
      targetId,
      details,
    });
  }

  list(filter?: AuditFilter) {
    return this.store.listAudit(filter);
  }
}
