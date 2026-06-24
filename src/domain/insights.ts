/**
 * insights — pure derivation of the admin stat breakdowns (members / coffees /
 * rewards) over a time range, from the audit log.
 *
 * No I/O, no React. Given the audit entries + a metric + a range + `now`, it
 * returns a chart series (time buckets) and the matching activity entries
 * (newest first). Counts are EVENTS (one accrual row = one coffee event), matching
 * the admin "coffees today" approximation. Unit-tested in isolation.
 */
import type { AuditAction, AuditLogEntry } from './models';

export type MetricKind = 'members' | 'active' | 'coffees' | 'rewards';
export type RangeKind = 'today' | 'week' | 'month' | 'all';

/** Audit actions that count toward each metric. */
const METRIC_ACTIONS: Record<MetricKind, ReadonlyArray<AuditAction>> = {
  members: ['customer.register', 'card.issue', 'card.provision'],
  // "Active" = a card that was used (any loyalty activity) in the period.
  active: ['loyalty.accrue', 'loyalty.redeem'],
  coffees: ['loyalty.accrue'],
  rewards: ['loyalty.redeem'],
};

/**
 * Metrics counted as UNIQUE customer cards per bucket (not events). For these,
 * the month range buckets by WEEK (coarser) so "active per week" reads cleanly.
 */
const UNIQUE_BY_CUSTOMER: Record<MetricKind, boolean> = {
  members: false,
  active: true,
  coffees: false,
  rewards: false,
};

export interface InsightBucket {
  /** Short axis label (e.g. "8", "Mon", "14", "Jan"). */
  label: string;
  /** Event count in this bucket. */
  value: number;
}

export interface InsightResult {
  /** Total events in the visible range. */
  total: number;
  /** Time-bucketed counts for the chart. */
  buckets: InsightBucket[];
  /** Matching entries, newest first (the UI pages them). */
  entries: AuditLogEntry[];
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(ms: number, monthDelta = 0): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + monthDelta);
  return d.getTime();
}

interface Slot {
  start: number;
  end: number;
  label: string;
}

/**
 * The (non-overlapping, ascending) chart slots for a range, ending at `now`.
 * `weeklyMonth` makes the month range bucket by week (used by unique-count
 * metrics, e.g. active members per week) instead of by day.
 */
function slotsFor(range: RangeKind, now: number, weeklyMonth = false): Slot[] {
  const slots: Slot[] = [];
  if (range === 'today') {
    // 12 two-hour slots across the calendar day.
    const base = startOfDay(now);
    for (let i = 0; i < 12; i++) {
      const start = base + i * 2 * HOUR;
      slots.push({ start, end: start + 2 * HOUR, label: String(new Date(start).getHours()) });
    }
  } else if (range === 'week') {
    // 7 daily slots ending today.
    const base = startOfDay(now - 6 * DAY);
    for (let i = 0; i < 7; i++) {
      const start = base + i * DAY;
      slots.push({ start, end: start + DAY, label: WEEKDAYS[new Date(start).getDay()] });
    }
  } else if (range === 'month' && weeklyMonth) {
    // 5 weekly slots ending this week (≈ a month), unique-per-week.
    const base = startOfDay(now - 34 * DAY);
    for (let i = 0; i < 5; i++) {
      const start = base + i * 7 * DAY;
      const d = new Date(start);
      slots.push({ start, end: start + 7 * DAY, label: `${d.getDate()}/${d.getMonth() + 1}` });
    }
  } else if (range === 'month') {
    // 30 daily slots ending today; label every 5th to avoid clutter.
    const base = startOfDay(now - 29 * DAY);
    for (let i = 0; i < 30; i++) {
      const start = base + i * DAY;
      const day = new Date(start).getDate();
      slots.push({ start, end: start + DAY, label: i % 5 === 0 ? String(day) : '' });
    }
  } else {
    // 'all' — 6 monthly slots ending this month.
    for (let m = 5; m >= 0; m--) {
      const start = startOfMonth(now, -m);
      const end = startOfMonth(now, -m + 1);
      slots.push({ start, end, label: MONTHS[new Date(start).getMonth()] });
    }
  }
  return slots;
}

const time = (e: AuditLogEntry): number => new Date(e.timestamp).getTime();

/**
 * Build the chart series + activity entries for a metric over a range.
 * `entries` is the full audit log (any order); only the matching action(s) and
 * the range window are considered.
 */
export function buildInsight(
  metric: MetricKind,
  range: RangeKind,
  entries: ReadonlyArray<AuditLogEntry>,
  now: number,
): InsightResult {
  const actions = METRIC_ACTIONS[metric];
  const unique = UNIQUE_BY_CUSTOMER[metric];
  const slots = slotsFor(range, now, unique);
  const windowStart = slots[0].start;

  const matched = entries
    .filter((e) => actions.includes(e.action) && time(e) >= windowStart && time(e) < now)
    .sort((a, b) => time(b) - time(a)); // newest first

  const buckets: InsightBucket[] = slots.map((s) => ({ label: s.label, value: 0 }));

  if (unique) {
    // Count UNIQUE customer cards (by audit targetId) per bucket and overall.
    const seen = slots.map(() => new Set<string>());
    for (const e of matched) {
      if (!e.targetId) continue;
      const idx = slots.findIndex((s) => time(e) >= s.start && time(e) < s.end);
      if (idx >= 0) seen[idx].add(e.targetId);
    }
    buckets.forEach((b, i) => (b.value = seen[i].size));
    const total = new Set(matched.map((e) => e.targetId).filter((id): id is string => Boolean(id)))
      .size;
    return { total, buckets, entries: matched };
  }

  for (const e of matched) {
    // Slots are contiguous and ascending; find the one containing this entry.
    const idx = slots.findIndex((s) => time(e) >= s.start && time(e) < s.end);
    if (idx >= 0) buckets[idx].value += 1;
  }
  return { total: matched.length, buckets, entries: matched };
}
