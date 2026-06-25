/**
 * Demo seed data (prototype only) — rewards-as-objects model.
 *
 * Generates a coherent set of members + ledger entries + discrete reward objects
 * + reward events + audit rows spread across today / this week / this month /
 * older, so the admin stat breakdowns (and their charts) have something to show
 * on a fresh or just-reset device. Deterministic given `now` (no randomness), so
 * it's stable to reason about and test. Tokens are distinct from the wallet
 * preset `PROTOcard…` tokens.
 *
 * In the rewards-as-objects model a redemption is NOT a ledger entry — it is a
 * {@link Reward} status change (`unspent` → `spent`) plus a `reward.redeemed`
 * event. The ledger therefore holds only `accrual` and `reward_issue(−threshold)`
 * entries, so the balance settles to 0..threshold−1. We still emit the matching
 * `loyalty.accrue` / `loyalty.redeem` AUDIT rows so the (transitional,
 * audit-based) admin stat breakdowns keep their content until Phase 3 moves them
 * onto the reward-event log.
 *
 * Seeded only on a truly-fresh DB (first run / after Reset) — never overwrites a
 * device that already has customers.
 */
import type {
  AuditLogEntry,
  Customer,
  LoyaltyTransaction,
  Reward,
  RewardEvent,
} from '../../domain/models';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Reward threshold for the demo (matches DEFAULT_CONFIG.pointsPerReward). */
const THRESHOLD = 8;
const REWARD_DESCRIPTION = 'Free regular coffee';

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
  rewards: Reward[];
  rewardEvents: RewardEvent[];
  audit: AuditLogEntry[];
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Deterministic 6-char Crockford suffix for a small index `n`. */
function base32(n: number): string {
  let s = '';
  let v = n;
  for (let k = 0; k < 6; k++) {
    s = CROCKFORD[v % 32] + s;
    v = Math.floor(v / 32);
  }
  return s;
}

/** Unique customer short code, e.g. DM00000C. */
function demoShortCode(n: number): string {
  return `DM${base32(n)}`;
}

/** Unique reward short code, e.g. RW00000C (disjoint from customer codes). */
function demoRewardCode(n: number): string {
  return `RW${base32(n)}`;
}

/**
 * Number of "coffees" (accruals) a member has bought — deterministic, 5..18, and
 * larger for older members so several rewards mint across the ranges.
 */
function coffeesFor(i: number): number {
  return 5 + ((i * 7) % 14);
}

/** Redemption event offsets, in hours before `now`, one per range band. */
const REDEEM_OFFSETS_HOURS = [2, 26, 24 * 5 + 4, 24 * 12 + 2, 24 * 20 + 8, 24 * 40 + 3];

export function buildDemoSeed(now: number): DemoSeed {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const customers: Customer[] = [];
  const transactions: LoyaltyTransaction[] = [];
  const rewards: Reward[] = [];
  const rewardEvents: RewardEvent[] = [];
  const audit: AuditLogEntry[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;
  let rewardSeq = 0;

  // Members, joined over the last ~50 days (newest first in MEMBER_NAMES order).
  MEMBER_NAMES.forEach((name, i) => {
    const joinDaysAgo = Math.round((i / MEMBER_NAMES.length) * 50);
    const createdMs = now - joinDaysAgo * DAY - (i % 5) * HOUR;
    const id = `demo-cust-${i + 1}`;
    customers.push({
      id,
      token: `DEMOcard${String(i + 1).padStart(4, '0')}aaaaaaaaaa`,
      shortCode: demoShortCode(i + 1),
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

    // Coffees (accruals) spread between join and now; mint a reward on each
    // threshold crossing (reward_issue ledger entry + Reward + reward.issued).
    const coffees = coffeesFor(i);
    let earned = 0;
    for (let k = 0; k < coffees; k++) {
      const frac = (k + 1) / (coffees + 1);
      const ts = Math.round(createdMs + frac * (now - createdMs));
      const staffId = STAFF_IDS[(i + k) % STAFF_IDS.length];
      transactions.push({
        id: nextId('demo-tx'),
        customerId: id,
        type: 'accrual',
        points: 1,
        staffId,
        timestamp: iso(ts),
      });
      audit.push({
        id: nextId('demo-aud'),
        actorId: staffId,
        actorRole: 'staff',
        action: 'loyalty.accrue',
        targetId: id,
        timestamp: iso(ts),
      });
      earned += 1;
      if (earned % THRESHOLD === 0) {
        const rewardId = `demo-rw-${++rewardSeq}`;
        const issueId = nextId('demo-tx');
        transactions.push({
          id: issueId,
          customerId: id,
          type: 'reward_issue',
          points: -THRESHOLD,
          staffId,
          timestamp: iso(ts),
          rewardId,
        });
        rewards.push({
          id: rewardId,
          token: `DEMOrwd${String(rewardSeq).padStart(4, '0')}aaaaaaaaaaa`,
          shortCode: demoRewardCode(rewardSeq),
          ownerId: id,
          status: 'unspent',
          issuedAt: iso(ts),
          sourceTxnId: issueId,
          descriptionSnapshot: REWARD_DESCRIPTION,
        });
        rewardEvents.push({
          id: nextId('demo-re'),
          rewardId,
          type: 'reward.issued',
          customerId: id,
          staffId,
          timestamp: iso(ts),
        });
      }
    }
  });

  // Redeem some of the minted rewards across the ranges so the admin "rewards
  // redeemed" breakdown has content. Each redemption marks the Reward spent +
  // appends a reward.redeemed event + a loyalty.redeem audit row.
  const mintable = rewards.filter((r) => r.status === 'unspent');
  REDEEM_OFFSETS_HOURS.forEach((h, i) => {
    const reward = mintable[i];
    if (!reward) return;
    const issuedMs = new Date(reward.issuedAt).getTime();
    // Redeem at the chosen offset, but never before the reward was issued.
    const redeemMs = Math.max(now - h * HOUR, issuedMs + HOUR);
    if (redeemMs >= now) return;
    const ts = iso(redeemMs);
    const staffId = STAFF_IDS[(i + 1) % STAFF_IDS.length];
    reward.status = 'spent';
    reward.spentAt = ts;
    reward.spentByStaffId = staffId;
    rewardEvents.push({
      id: nextId('demo-re'),
      rewardId: reward.id,
      type: 'reward.redeemed',
      customerId: reward.ownerId,
      staffId,
      timestamp: ts,
    });
    audit.push({
      id: nextId('demo-aud'),
      actorId: staffId,
      actorRole: 'staff',
      action: 'loyalty.redeem',
      targetId: reward.ownerId,
      timestamp: ts,
    });
  });

  return { customers, transactions, rewards, rewardEvents, audit };
}
