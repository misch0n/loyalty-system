/**
 * Shared helpers for rendering the staff/admin activity feed from audit
 * entries (UI-SPEC §4.8/§4.10). Pure formatting — no I/O.
 *
 * The audit ledger never stores PII (CLAUDE.md): entries carry an `actorId`
 * (resolved to a staff NAME for attribution) and a `targetId` (the customerId,
 * resolved to a name only at render time from the customer record). These
 * helpers turn the raw entry into the "Sam · added a coffee · Maria · 2m" shape
 * the kit `ActivityRow` expects.
 */

import type { AuditAction } from '../../../domain/models';

const LOYALTY_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'loyalty.accrue',
  'loyalty.redeem',
  'loyalty.reverse',
]);

/** True for the loyalty.* subset shown on the staff panel. */
export function isLoyaltyAction(action: AuditAction): boolean {
  return LOYALTY_ACTIONS.has(action);
}

/** End-user phrasing for a loyalty action ("added a coffee"). */
export function actionLabel(action: AuditAction, details?: string): string {
  switch (action) {
    case 'loyalty.accrue': {
      const n = details ? Number(details.replace(/[^0-9]/g, '')) : NaN;
      if (Number.isFinite(n) && n > 1) return `added ${n} coffees`;
      return 'added a coffee';
    }
    case 'loyalty.redeem':
      return 'redeemed a reward';
    case 'loyalty.reverse':
      return 'undid an entry';
    default:
      return 'logged activity';
  }
}

/** Compact relative time ("2m", "3h", "1d", "just now"). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
