/**
 * AuditService — writes the append-only action trail.
 *
 * Every staff/admin action funnels a record through here. `details` must never
 * contain PII (name/email/phone); pass ids and neutral context only.
 */

import type { AuditAction } from '../domain/models';
import type { AuditFilter, DataStore } from '../ports/DataStore';
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
