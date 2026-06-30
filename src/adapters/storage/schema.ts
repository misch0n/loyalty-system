/**
 * IndexedDB schema definition + default seed values.
 *
 * Kept separate from the adapter so the store shape is easy to review and the
 * seed data (default config + mock staff accounts) is in one obvious place.
 */

import type { DBSchema } from 'idb';
import type {
  AuditLogEntry,
  Customer,
  LoyaltyTransaction,
  ProgramConfig,
  Reward,
  RewardEvent,
  StaffAccount,
} from '../../domain/models';
import type { CommitResult } from '../../ports/DataStore';

export const DB_NAME = 'cafe-loyalty';
/**
 * CLEAN RESET on upgrade: the upgrade drops every existing store and recreates
 * the full schema below, then the seed repopulates in the new model. The
 * prototype has no live customer data to migrate, so dropping + recreating
 * eliminates the riskiest (lossy) migration class — see REWARDS-DECISIONS Q2.
 *
 * v5 introduced the rewards-as-objects model (REWARDS-PLAN Phase 2). v6 reseeds
 * so existing devices adopt the 9-stamp card (reward threshold 8 → 9; the
 * "welcome" freebie cup is gone — the customer earns nine cups and the tenth
 * coffee is free).
 */
export const DB_VERSION = 6;

export const CONFIG_KEY = 'singleton';

/**
 * A single-use, short-expiry recovery code. Maps an opaque random secret to a
 * customerId only — never any PII. Consumed atomically (see IndexedDbStore).
 */
export interface RecoveryCodeRecord {
  code: string;
  customerId: string;
  expiresAt: number; // epoch ms
  usedAt?: number; // epoch ms; set once on consume
}

/**
 * Idempotency-dedup record (rewards-as-objects, REWARDS-PLAN §3.3 / Q5). Maps a
 * commit's `idempotencyKey` to its cached {@link CommitResult} so a retried RPC
 * commit (the paired-device path has a 10s retry) returns the same result with
 * NO re-writes. Also carries the minimal effect of the commit so `undoCommit`
 * can reverse it without re-deriving (points reversed, fresh mints voided, spent
 * rewards re-minted). All ids only — never PII.
 */
export interface IdempotencyRecord {
  key: string;
  /** The original commit's result, replayed verbatim on a same-key retry. */
  result: CommitResult;
  /** Staff member who committed it (attribution for the undo's reversal/reissue). */
  staffId: string;
  /** Points the commit accrued (to compute the reversal). */
  pointsDelta: number;
  /** Threshold in force at commit time (pointsPerReward). */
  threshold: number;
  /** Ids of rewards the commit minted (voided on undo). */
  mintedRewardIds: string[];
  /** Ids of rewards the commit redeemed (each re-minted on undo). */
  spentRewardIds: string[];
  /** Set once the commit has been undone (a second undo is a cached no-op). */
  undone?: boolean;
  /** Cached undo outcome, so a repeat `undoCommit` is idempotent. */
  undoResult?: CommitResult;
}

export interface LoyaltyDB extends DBSchema {
  config: {
    key: string;
    value: ProgramConfig & { id: string };
  };
  staff: {
    key: string;
    value: StaffAccount;
    indexes: { byUsername: string };
  };
  customers: {
    key: string;
    value: Customer;
    indexes: { byToken: string; byStatus: string; byShortCode: string };
  };
  transactions: {
    key: string;
    value: LoyaltyTransaction;
    indexes: { byCustomer: string };
  };
  /**
   * Materialized {@link Reward} projections (rewards-as-objects). The append-only
   * `rewardEvents` log is the source of truth for status; this store is the
   * fast-read cache + the row a redeem locks on (within the commit tx).
   */
  rewards: {
    key: string;
    value: Reward;
    indexes: { byOwner: string; byToken: string; byStatus: string; byShortCode: string };
  };
  /** Append-only reward-lifecycle log (issued / redeemed / voided). */
  rewardEvents: {
    key: string;
    value: RewardEvent;
    indexes: { byReward: string; byOwner: string };
  };
  audit: {
    key: string;
    value: AuditLogEntry;
    indexes: { byTimestamp: string; byAction: string };
  };
  recoveryCodes: {
    key: string;
    value: RecoveryCodeRecord;
  };
  /** Commit idempotency-dedup cache (keyed by `idempotencyKey`). */
  idempotencyKeys: {
    key: string;
    value: IdempotencyRecord;
  };
}

export const DEFAULT_CONFIG: ProgramConfig = {
  pointsPerReward: 9,
  rewardDescription: 'Free regular coffee',
  pointsPerPurchase: 1,
  maxPointsPerTransaction: 3,
  cardInactivityDays: 0,
};

/**
 * Mock staff for the prototype. Passwords are plain strings ONLY because auth
 * is mocked here — production hashes them server-side. This is demo seed data,
 * never real credentials.
 */
export const SEED_STAFF: StaffAccount[] = [
  {
    id: 'seed-admin',
    username: 'admin',
    name: 'Manager',
    passwordHash: 'admin',
    pin: '4321',
    role: 'admin',
    active: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-staff',
    username: 'staff',
    name: 'Sam',
    passwordHash: 'staff',
    pin: '1234',
    role: 'staff',
    active: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-staff-2',
    username: 'priya',
    name: 'Priya',
    passwordHash: 'priya',
    pin: '2468',
    role: 'staff',
    active: true,
    createdAt: '2024-01-02T00:00:00.000Z',
  },
];
