/**
 * Server-side suspicious-activity detection (BE-S-09).
 *
 * `domain/alerts.ts` is pure and moves here unchanged — the two detectors,
 * their thresholds and their reasoning are the product's, not the transport's.
 * What changes is *where* the inputs come from, and that change is the point:
 *
 *   • Self-dealing pairs `loyalty.accrue` / `loyalty.redeem` **audit** rows,
 *     which Phase 4 makes the route write from the session (§4-C, §4-D). In the
 *     prototype the client wrote them, so the detectors judged fraud using data
 *     the person committing it authored. That is why SCOPE-DECISIONS §3.1
 *     reinstated server-written audit after the triage had dropped it.
 *   • The ranged, multi-actor audit query it reads is an **internal capability
 *     with no route attached** (SCOPE-DECISIONS §3.1, Q5). Detection is the only
 *     caller. `GET /audit` is scoped to the requesting actor and cannot reach
 *     across accounts, so the derived alerts are the *only* cross-account view
 *     the API offers — and it returns findings, never rows.
 *
 * Alerts surface; they never block. There is no role exemption: an admin's
 * actions are detected exactly like a staff member's.
 */

import { deriveAlerts, DEFAULT_THRESHOLDS } from '@cafe/shared/domain/alerts';
import type { Alert, AlertThresholds, AttributedEvent } from '@cafe/shared/domain/alerts';
import { alertKey } from '@cafe/shared/domain/alerts';
import type { AuditLogEntry, ProgramConfig } from '@cafe/shared/domain/models';
import type { DataStore } from '@cafe/shared/ports/DataStore';

/**
 * How far back detection looks.
 *
 * The prototype reads the whole ledger and the whole audit log, which is free
 * against IndexedDB and an unbounded table scan here (§4-E). A window is also
 * better *detection*: both detectors measure a pattern inside seconds or
 * minutes, so a year-old pair contributes nothing but work. Thirty days keeps a
 * slow-burn pattern visible while bounding the query.
 */
export const DETECTION_WINDOW_DAYS = 30;

/** The detector-threshold slice of the config; unset fields fall through. */
function pickThresholds(config: ProgramConfig): Partial<AlertThresholds> {
  const out: Partial<AlertThresholds> = {};
  if (config.selfDealWindowSec != null) out.selfDealWindowSec = config.selfDealWindowSec;
  if (config.selfDealCount != null) out.selfDealCount = config.selfDealCount;
  if (config.repeatCount != null) out.repeatCount = config.repeatCount;
  if (config.repeatWindowMin != null) out.repeatWindowMin = config.repeatWindowMin;
  return out;
}

function toEvents(rows: AuditLogEntry[], kind: AttributedEvent['kind']): AttributedEvent[] {
  const events: AttributedEvent[] = [];
  for (const row of rows) {
    // A row with no target names no card, so it cannot be half of a pair.
    if (!row.targetId) continue;
    events.push({ staffId: row.actorId, customerId: row.targetId, at: row.timestamp, kind });
  }
  return events;
}

/**
 * Derives the current alerts. Mirrors `LoyaltyService.getAlerts` — same two
 * detectors, same config-backed thresholds, same dismissal filter — so the
 * findings do not change shape when the store behind them does.
 */
export async function deriveServerAlerts(
  store: DataStore,
  now: () => number = Date.now,
): Promise<Alert[]> {
  const from = new Date(now() - DETECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [config, staff, transactions, accrued, redeemed] = await Promise.all([
    store.getConfig(),
    store.listStaff(),
    store.listAllTransactions(),
    store.listAudit({ action: 'loyalty.accrue', from }),
    store.listAudit({ action: 'loyalty.redeem', from }),
  ]);

  const thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS, ...pickThresholds(config) };
  const events = [...toEvents(accrued, 'accrue'), ...toEvents(redeemed, 'redeem')];

  // Repeat-target reads the ledger, which the store returns whole; the window
  // is applied here so both detectors see the same span.
  const recent = transactions.filter((tx) => tx.timestamp >= from);

  const staffNames: Record<string, string> = {};
  for (const member of staff) staffNames[member.id] = member.name ?? member.username;

  const dismissed = new Set(config.dismissedAlerts ?? []);
  return deriveAlerts(recent, events, thresholds, staffNames).filter(
    (alert) => !dismissed.has(alertKey(alert)),
  );
}
