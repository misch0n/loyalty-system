/**
 * Suspicious-activity heuristics (Appendix E) — pure, derived, monitoring-only.
 *
 * Appendix E pruned the detector set to exactly TWO, on the principle that the
 * system "remembers everything, judges almost nothing, and announces the little
 * it judges". Velocity, oversized-multi-add, off-hours and outlier-share were
 * dropped: in a one-café shop they fire constantly on ordinary trading (a rush,
 * a big round, an early opener, a single staffer on shift) and a detector that
 * cries wolf is worse than no detector.
 *
 * What remains flags a *pattern with a beneficiary*:
 *   • self-dealing   — the same staff member credits a card and immediately
 *                      redeems its reward, repeatedly.
 *   • repeat-target  — the same staff member credits the same card over and over
 *                      inside a short window.
 *
 * Both apply to admins too — there is no role exemption — and both SURFACE, they
 * never block. Thresholds come from `ProgramConfig` so the owner can tune them.
 *
 * PURE: no I/O, no React, no browser APIs. The service layer assembles the
 * inputs (ledger + attributed audit events + config + staff names) and calls
 * `deriveAlerts`. `LoyaltyTransaction` has no `deviceId` in v1, so `deviceId` is
 * optional and omitted — the ledger schema is NOT changed for this.
 */

import type { LoyaltyTransaction } from './models.js';

export type AlertKind = 'self-dealing' | 'repeat-target';

/** A single flagged finding. `staffId` always present; resolve names in the UI. */
export interface Alert {
  kind: AlertKind;
  staffId: string;
  customerId?: string;
  /** Optional: derived if a transaction ever carries one; omitted otherwise. */
  deviceId?: string;
  /** ISO timestamp the trigger is anchored to (usually the latest entry). */
  at: string;
  /** Human-readable, PII-free explanation of the trigger. */
  detail: string;
  /** Resolved staff name when a lookup was provided (display convenience). */
  staffName?: string;
}

/**
 * One attributed loyalty action, normalized across its two sources so the
 * self-dealing detector can pair them. Accruals and redemptions both come from
 * the audit log (`loyalty.accrue` / `loyalty.redeem`), which carries a uniform
 * actor + target + timestamp for every counter action.
 */
export interface AttributedEvent {
  staffId: string;
  customerId: string;
  /** ISO timestamp. */
  at: string;
  kind: 'accrue' | 'redeem';
}

/** Tunable thresholds (config-backed so a small café can curb false positives). */
export interface AlertThresholds {
  /** Self-dealing: a redeem within this many SECONDS of an accrual… */
  selfDealWindowSec: number;
  /** …by the same staff on the same card, flagged at this many occurrences. */
  selfDealCount: number;
  /** Repeat-target: same customer credited more than this many times… */
  repeatCount: number;
  /** …within this many minutes by the same staff member. */
  repeatWindowMin: number;
}

/** Sensible small-café defaults; the owner can override any field. */
export const DEFAULT_THRESHOLDS: AlertThresholds = {
  selfDealWindowSec: 30,
  selfDealCount: 3,
  repeatCount: 3,
  repeatWindowMin: 30,
};

const MS_PER_MIN = 60_000;
const MS_PER_SEC = 1_000;

function ms(ts: string): number {
  return new Date(ts).getTime();
}

function isCredit(tx: LoyaltyTransaction): boolean {
  // A "credit" = a positive accrual. Reversals/reward issues are not credits.
  return tx.type === 'accrual' && tx.points > 0;
}

function sortByTime<T extends { timestamp: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Derive all alerts. `transactions` feeds repeat-target (the ledger is the
 * authority on credits); `events` feeds self-dealing (attributed accrue/redeem
 * pairs). `staffNames` (id → name) is optional and used only to decorate
 * `staffName`; absence never changes which alerts fire.
 */
export function deriveAlerts(
  transactions: LoyaltyTransaction[],
  events: AttributedEvent[] = [],
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
  staffNames: Readonly<Record<string, string>> = {},
): Alert[] {
  const alerts: Alert[] = [];

  selfDealingAlerts(events, thresholds, alerts);
  repeatTargetAlerts(transactions, thresholds, alerts);

  // Decorate with names + keep deterministic order (newest trigger first).
  for (const a of alerts) {
    const name = staffNames[a.staffId];
    if (name) a.staffName = name;
  }
  return alerts.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Self-dealing proximity: the same staff member credits a card and redeems one
 * of its rewards within `selfDealWindowSec`, and does so at least
 * `selfDealCount` times. A single close pair is ordinary — a customer who
 * qualifies on this purchase and takes the free coffee straight away is the
 * normal case — so only the REPEATED pattern flags.
 *
 * Fed from the `loyalty.accrue` / `loyalty.redeem` audit rows. The old detector
 * matched ledger entries of type `redemption`, which the rewards-as-objects
 * rework stopped writing, so it silently fired on nothing.
 */
function selfDealingAlerts(
  events: AttributedEvent[],
  t: AlertThresholds,
  out: Alert[],
): void {
  const windowMs = t.selfDealWindowSec * MS_PER_SEC;
  // Group by staff+customer: the pattern is one staffer working one card.
  const byPair = new Map<string, AttributedEvent[]>();
  for (const e of events) {
    const key = `${e.staffId} ${e.customerId}`;
    const list = byPair.get(key) ?? [];
    list.push(e);
    byPair.set(key, list);
  }

  for (const [, group] of byPair) {
    const rows = [...group].sort((a, b) => a.at.localeCompare(b.at));
    let pairs = 0;
    let last: Alert | null = null;
    for (let i = 0; i < rows.length; i += 1) {
      const redeem = rows[i];
      if (!redeem || redeem.kind !== 'redeem') continue;
      // Look back for the nearest accrual on this card by this staffer.
      for (let j = i - 1; j >= 0; j -= 1) {
        const accrual = rows[j];
        if (!accrual || accrual.kind !== 'accrue') continue;
        if (ms(redeem.at) - ms(accrual.at) <= windowMs) {
          pairs += 1;
          last = {
            kind: 'self-dealing',
            staffId: redeem.staffId,
            customerId: redeem.customerId,
            at: redeem.at,
            detail: '',
          };
        }
        break; // only the nearest prior accrual counts
      }
    }
    if (last && pairs >= t.selfDealCount) {
      out.push({
        ...last,
        detail:
          `Credited then redeemed on the same card within ${t.selfDealWindowSec}s, ` +
          `${pairs} times (limit ${t.selfDealCount}).`,
      });
    }
  }
}

/** Repeat target: same customer credited > N times in a window by same staff. */
function repeatTargetAlerts(
  transactions: LoyaltyTransaction[],
  t: AlertThresholds,
  out: Alert[],
): void {
  const windowMs = t.repeatWindowMin * MS_PER_MIN;
  const byPair = new Map<string, LoyaltyTransaction[]>();
  for (const tx of transactions) {
    if (!isCredit(tx)) continue;
    const key = `${tx.staffId} ${tx.customerId}`;
    const list = byPair.get(key) ?? [];
    list.push(tx);
    byPair.set(key, list);
  }
  for (const [, txs] of byPair) {
    const rows = sortByTime(txs);
    let start = 0;
    for (let end = 0; end < rows.length; end += 1) {
      const latest = rows[end];
      if (!latest) continue;
      let earliest = rows[start];
      while (earliest && ms(latest.timestamp) - ms(earliest.timestamp) > windowMs) {
        start += 1;
        earliest = rows[start];
      }
      const count = end - start + 1;
      if (count > t.repeatCount) {
        out.push({
          kind: 'repeat-target',
          staffId: latest.staffId,
          customerId: latest.customerId,
          at: latest.timestamp,
          detail: `Same customer credited ${count} times within ${t.repeatWindowMin} min (limit ${t.repeatCount}).`,
        });
        break;
      }
    }
  }
}

/**
 * Stable key for an alert, used to persist an admin's dismissal (acknowledgement).
 * Stable across re-derivations while the triggering ledger data is unchanged.
 */
export function alertKey(a: Alert): string {
  return `${a.kind}:${a.staffId}:${a.customerId ?? ''}:${a.at}`;
}
