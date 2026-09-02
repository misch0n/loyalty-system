/**
 * AuditService — writes the append-only action trail.
 *
 * Every staff/admin action funnels a record through here. `details` must never
 * contain PII (name/email/phone); pass ids and neutral context only.
 */

import type { AuditAction, AuditLogEntry } from '../domain/models';
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

  /**
   * Run an admin activity export (Appendix E). Reading cross-account activity is
   * an investigation, so it is deliberately a distinct operation from `list`:
   * it demands a stated `reason` and writes an `audit.export` row of its own
   * before returning the rows. Exports are therefore themselves auditable, and
   * the stored filter lets the export view list and re-run past investigations.
   *
   * The reason is free text typed by an admin. It is stored in `details`, which
   * must never contain PII — the UI labels the field accordingly, and the
   * reason is trimmed and length-capped here.
   */
  async exportActivity(
    actor: Pick<Actor, 'id' | 'role'>,
    filter: AuditFilter,
    reason: string,
  ): Promise<AuditLogEntry[]> {
    const trimmed = reason.trim();
    if (!trimmed) throw new Error('An export needs a reason.');
    const rows = await this.store.listAudit(filter);
    const record: ExportRecord = {
      reason: trimmed.slice(0, REASON_MAX),
      from: filter.from,
      to: filter.to,
      actions: filter.actions,
      actorIds: filter.actorIds,
      count: rows.length,
    };
    await this.log(actor, 'audit.export', undefined, JSON.stringify(record));
    return rows;
  }
}

/** Longest reason stored on the audit row. */
const REASON_MAX = 300;

/**
 * What an `audit.export` row records in `details` (JSON): the stated reason,
 * the filter that was run, and how many rows it returned. Ids only — no PII.
 */
export interface ExportRecord {
  reason: string;
  from?: string;
  to?: string;
  actions?: AuditAction[];
  actorIds?: string[];
  count: number;
}

/** Parse an `audit.export` row's `details`; null when it isn't a valid record. */
export function parseExportRecord(details: string | undefined): ExportRecord | null {
  if (!details) return null;
  try {
    const parsed: unknown = JSON.parse(details);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as ExportRecord;
    return typeof record.reason === 'string' ? record : null;
  } catch {
    return null;
  }
}
