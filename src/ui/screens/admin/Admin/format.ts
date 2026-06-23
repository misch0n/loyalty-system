/**
 * Admin display helpers for the reference-UI Admin screen. Pure formatting —
 * no I/O, no JSX. Maps audit actions to the donor feed tone + a friendly verb,
 * and renders compact relative timestamps. Authoritative data still comes from
 * the services.
 */
import type { AuditAction } from '../../../../domain/models';
import type { FeedTone } from '../_parts/FeedRow/FeedRow';

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
    case 'staff.delete':
      return 'deleted a staff account';
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

/** Map an audit action to a donor feed-row tone (icon tint). */
export function auditTone(action: AuditAction): FeedTone {
  switch (action) {
    case 'loyalty.accrue':
    case 'card.issue':
    case 'card.provision':
      return 'add';
    case 'loyalty.redeem':
    case 'customer.delete':
    case 'staff.disable':
    case 'staff.delete':
    case 'staff.login.failed':
      return 'red';
    case 'loyalty.reverse':
    case 'config.update':
      return 'warn';
    default:
      return 'new';
  }
}
