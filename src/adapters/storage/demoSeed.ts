/**
 * Demo seed data (prototype only).
 *
 * Generates a coherent set of members + ledger entries + audit rows spread
 * across today / this week / this month / older, so the admin stat breakdowns
 * (and their charts) have something to show on a fresh or just-reset device.
 * Deterministic given `now` (no randomness), so it's stable to reason about and
 * test. Tokens are distinct from the wallet preset `PROTOcard…` tokens.
 *
 * Seeded only on a truly-fresh DB (first run / after Reset) — never overwrites a
 * device that already has customers.
 */
import type { AuditLogEntry, Customer, LoyaltyTransaction } from '../../domain/models';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Seed staff ids used for attribution (must match SEED_STAFF). */
const STAFF_IDS = ['seed-staff', 'seed-staff-2', 'seed-admin'] as const;

const MEMBER_NAMES = [
  'Maria',
  'Liang',
  'Aisha',
  'Tom',
  'Yuki',
  'Nadia',
  'Carlos',
  'Ingrid',
  'Omar',
  'Sofia',
  'Pedro',
  'Hana',
];

export interface DemoSeed {
  customers: Customer[];
  transactions: LoyaltyTransaction[];
  audit: AuditLogEntry[];
}

/** Accrual ("coffee") event offsets, in hours before `now`, spread over ~7 weeks. */
function accrualOffsetsHours(): number[] {
  const out: number[] = [];
  // Today — a handful through the day.
  for (let h = 1; h <= 10; h += 1.5) out.push(h);
  // This week (1–6 days ago) — two a day.
  for (let d = 1; d <= 6; d += 1) {
    out.push(d * 24 + 3);
    out.push(d * 24 + 9);
  }
  // This month (8–28 days ago) — every ~3 days.
  for (let d = 8; d <= 28; d += 3) out.push(d * 24 + 5);
  // Older (32–48 days ago) — every ~4 days.
  for (let d = 32; d <= 48; d += 4) out.push(d * 24 + 6);
  return out;
}

/** Redemption event offsets, in hours before `now`, one per range band. */
const REDEEM_OFFSETS_HOURS = [2, 26, 24 * 5 + 4, 24 * 12 + 2, 24 * 20 + 8, 24 * 40 + 3];

export function buildDemoSeed(now: number): DemoSeed {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const customers: Customer[] = [];
  const transactions: LoyaltyTransaction[] = [];
  const audit: AuditLogEntry[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;

  // Members, joined over the last ~50 days (newest first in MEMBER_NAMES order).
  MEMBER_NAMES.forEach((name, i) => {
    const joinDaysAgo = Math.round((i / MEMBER_NAMES.length) * 50);
    const createdMs = now - joinDaysAgo * DAY - (i % 5) * HOUR;
    const id = `demo-cust-${i + 1}`;
    customers.push({
      id,
      token: `DEMOcard${String(i + 1).padStart(4, '0')}aaaaaaaaaa`,
      displayName: name,
      email: i % 3 === 0 ? undefined : `${name.toLowerCase()}@example.com`,
      status: 'active',
      createdAt: iso(createdMs),
    });
    audit.push({
      id: nextId('demo-aud'),
      actorId: STAFF_IDS[i % STAFF_IDS.length],
      actorRole: 'staff',
      action: 'customer.register',
      targetId: id,
      timestamp: iso(createdMs),
    });
  });

  const customerAt = (i: number): Customer => customers[i % customers.length];
  const staffAt = (i: number): string => STAFF_IDS[i % STAFF_IDS.length];

  // Coffees (accruals) across the ranges.
  accrualOffsetsHours().forEach((h, i) => {
    const ts = iso(now - h * HOUR);
    const customer = customerAt(i * 3 + 1);
    const staffId = staffAt(i);
    const points = (i % 2) + 1;
    transactions.push({
      id: nextId('demo-tx'),
      customerId: customer.id,
      type: 'accrual',
      points,
      staffId,
      timestamp: ts,
    });
    audit.push({
      id: nextId('demo-aud'),
      actorId: staffId,
      actorRole: 'staff',
      action: 'loyalty.accrue',
      targetId: customer.id,
      timestamp: ts,
    });
  });

  // Rewards redeemed across the ranges.
  REDEEM_OFFSETS_HOURS.forEach((h, i) => {
    const ts = iso(now - h * HOUR);
    const customer = customerAt(i * 2);
    const staffId = staffAt(i + 1);
    transactions.push({
      id: nextId('demo-tx'),
      customerId: customer.id,
      type: 'redemption',
      points: -8,
      staffId,
      timestamp: ts,
      note: 'Free regular coffee',
    });
    audit.push({
      id: nextId('demo-aud'),
      actorId: staffId,
      actorRole: 'staff',
      action: 'loyalty.redeem',
      targetId: customer.id,
      timestamp: ts,
    });
  });

  return { customers, transactions, audit };
}
