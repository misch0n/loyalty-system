/**
 * Admin display helpers (UI-SPEC §4.10). Pure formatting — no I/O, no JSX.
 *
 * Maps audit/alert internals to the café's plain, active-voice vocabulary and
 * renders relative timestamps. Everything here is presentational glue; the
 * authoritative data still comes from the services.
 */

import type { AuditAction } from '../../../domain/models';
import type { AlertKind } from '../../../domain/alerts';
import type { AlertSeverity } from '../../kit';

/** Compact relative time, e.g. "now", "2m", "3h", "5d". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 45) return 'now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  return `${weeks}w`;
}

/** True when an ISO timestamp falls on the same calendar day as `now`. */
export function isSameDay(iso: string, now: number = Date.now()): boolean {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  const today = new Date(now);
  return (
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate()
  );
}

/** Friendly, end-user verb for an audit action (active voice, sentence case). */
export function auditVerb(action: AuditAction): string {
  switch (action) {
    case 'staff.login':
      return 'signed in';
    case 'staff.login.failed':
      return 'failed a sign-in';
    case 'staff.create':
      return 'added a staff account';
    case 'staff.disable':
      return 'disabled a staff account';
    case 'staff.enable':
      return 'enabled a staff account';
    case 'staff.resetPassword':
      return 'reset a staff password';
    case 'card.issue':
      return 'issued a card';
    case 'card.reissue':
      return 'reissued a card';
    case 'card.provision':
      return 'provisioned a card';
    case 'customer.register':
      return 'registered a member';
    case 'customer.recover':
      return 'recovered a card';
    case 'customer.correct':
      return 'corrected member details';
    case 'customer.delete':
      return 'deleted a member';
    case 'loyalty.accrue':
      return 'added a coffee';
    case 'loyalty.redeem':
      return 'redeemed a reward';
    case 'loyalty.reverse':
      return 'undid an entry';
    case 'config.update':
      return 'changed the program';
    default:
      return action;
  }
}

/** Friendly label for a suspicious-activity trigger. */
export function alertTrigger(kind: AlertKind): string {
  switch (kind) {
    case 'velocity':
      return 'Fast burst of credits';
    case 'repeat-target':
      return 'Same member credited repeatedly';
    case 'oversized-multi-add':
      return 'Oversized multi-add';
    case 'off-hours':
      return 'Credit outside opening hours';
    case 'outlier-share':
      return 'Unusual share of credits';
    case 'earn-then-redeem':
      return 'Earn then redeem in quick succession';
    default:
      return kind;
  }
}

/** Map an alert kind to a severity tint for AlertRow. */
export function alertSeverity(kind: AlertKind): AlertSeverity {
  switch (kind) {
    case 'oversized-multi-add':
    case 'velocity':
      return 'high';
    case 'repeat-target':
    case 'earn-then-redeem':
      return 'medium';
    default:
      return 'low';
  }
}
