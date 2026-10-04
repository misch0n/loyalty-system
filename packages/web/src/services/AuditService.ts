/**
 * AuditService — reads the signed-in account's own action trail.
 *
 * It no longer writes anything. Every route that changes something appends its
 * own audit row, with the actor taken from the session (BACKEND-PLAN §4-C), so a
 * client-side `log` would have been either a second row or a forgery — the
 * server answers `POST /audit` with 204 and writes nothing. The write path left
 * the services in UI-2 (`UI-RECONCILIATION.md` P7).
 *
 * The read is the session's own rows, always: `GET /audit` replaces any actor
 * filter with the signed-in account (§4-F). That is what the counter's "your
 * last hour" shows. The admin activity export went with the Export sheet (UI-0).
 */

import type { AuditFilter, DataStore } from '@cafe/shared/ports/DataStore';

export class AuditService {
  constructor(private readonly store: DataStore) {}

  list(filter?: AuditFilter) {
    return this.store.listAudit(filter);
  }
}
