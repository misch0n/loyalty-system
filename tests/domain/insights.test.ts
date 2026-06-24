/**
 * insights — chart series + activity entries derived from the audit log.
 */
import { describe, it, expect } from 'vitest';
import { buildInsight } from '../../src/domain/insights';
import type { AuditAction, AuditLogEntry } from '../../src/domain/models';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Anchor "now" at midday so today's 2-hour slots have room before it.
const NOW = new Date(2026, 5, 24, 13, 0, 0).getTime();

let seq = 0;
function entry(action: AuditAction, msAgo: number): AuditLogEntry {
  return {
    id: `e-${++seq}`,
    actorId: 'seed-staff',
    actorRole: 'staff',
    action,
    timestamp: new Date(NOW - msAgo).toISOString(),
  };
}

describe('buildInsight', () => {
  it('counts only the metric’s actions within the range, newest first', () => {
    const entries: AuditLogEntry[] = [
      entry('loyalty.accrue', 1 * HOUR), // today
      entry('loyalty.accrue', 3 * HOUR), // today
      entry('loyalty.redeem', 2 * HOUR), // today, different metric
      entry('loyalty.accrue', 2 * DAY), // outside "today"
    ];
    const today = buildInsight('coffees', 'today', entries, NOW);
    expect(today.total).toBe(2);
    expect(today.entries).toHaveLength(2);
    // Newest first.
    expect(new Date(today.entries[0].timestamp).getTime()).toBeGreaterThan(
      new Date(today.entries[1].timestamp).getTime(),
    );
    // Bucket counts sum to the total.
    expect(today.buckets.reduce((s, b) => s + b.value, 0)).toBe(2);
  });

  it('widens with the range (week includes earlier days)', () => {
    const entries: AuditLogEntry[] = [
      entry('loyalty.accrue', 1 * HOUR),
      entry('loyalty.accrue', 2 * DAY),
      entry('loyalty.accrue', 5 * DAY),
      entry('loyalty.accrue', 20 * DAY), // outside the week
    ];
    expect(buildInsight('coffees', 'today', entries, NOW).total).toBe(1);
    expect(buildInsight('coffees', 'week', entries, NOW).total).toBe(3);
    expect(buildInsight('coffees', 'month', entries, NOW).total).toBe(4);
  });

  it('members counts registration/issue/provision actions', () => {
    const entries: AuditLogEntry[] = [
      entry('customer.register', 1 * HOUR),
      entry('card.issue', 2 * HOUR),
      entry('card.provision', 3 * HOUR),
      entry('loyalty.accrue', 1 * HOUR), // not a member action
    ];
    expect(buildInsight('members', 'today', entries, NOW).total).toBe(3);
  });

  it('produces the expected number of chart buckets per range', () => {
    const none: AuditLogEntry[] = [];
    expect(buildInsight('coffees', 'today', none, NOW).buckets).toHaveLength(12);
    expect(buildInsight('coffees', 'week', none, NOW).buckets).toHaveLength(7);
    expect(buildInsight('coffees', 'month', none, NOW).buckets).toHaveLength(30);
    expect(buildInsight('coffees', 'all', none, NOW).buckets).toHaveLength(6);
  });

  it('active members counts UNIQUE customer cards (by targetId), not events', () => {
    const e = (action: AuditAction, msAgo: number, customer: string): AuditLogEntry => ({
      id: `e-${++seq}`,
      actorId: 'seed-staff',
      actorRole: 'staff',
      action,
      targetId: customer,
      timestamp: new Date(NOW - msAgo).toISOString(),
    });
    const entries: AuditLogEntry[] = [
      e('loyalty.accrue', 1 * HOUR, 'c1'),
      e('loyalty.accrue', 2 * HOUR, 'c1'), // same card again today → still 1 unique
      e('loyalty.redeem', 3 * HOUR, 'c2'), // a second unique card today
      e('loyalty.accrue', 2 * DAY, 'c3'), // earlier in the week
    ];
    expect(buildInsight('active', 'today', entries, NOW).total).toBe(2); // c1, c2
    expect(buildInsight('active', 'week', entries, NOW).total).toBe(3); // c1, c2, c3
  });

  it('active members buckets the month range by WEEK (others stay daily)', () => {
    const none: AuditLogEntry[] = [];
    expect(buildInsight('active', 'month', none, NOW).buckets).toHaveLength(5);
    expect(buildInsight('coffees', 'month', none, NOW).buckets).toHaveLength(30);
  });
});
