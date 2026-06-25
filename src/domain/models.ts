/**
 * Entity types — the shared vocabulary of the whole system.
 *
 * Pure types only: no behaviour, no I/O. These move/share directly into the
 * production Node backend (the `domain/` and `ports/` layers are stack-agnostic).
 */

export type StaffRole = 'admin' | 'staff';
export type CustomerStatus = 'active' | 'deleted';

/**
 * Ledger entry kinds.
 *
 * `'reward_issue'` is the rewards-as-objects replacement for the old
 * `'redemption'`: a minting accrual (−threshold) that spawns a discrete
 * {@link Reward}. `'redemption'` is RETAINED ONLY TRANSITIONALLY so pre-rework
 * code keeps compiling — it is removed once the storage rework (REWARDS-PLAN
 * Phase 2) lands. New code must never emit `'redemption'`.
 */
export type TransactionType = 'accrual' | 'reward_issue' | 'reversal' | 'redemption';

/** Single, admin-editable record describing the loyalty program rules. */
export interface ProgramConfig {
  /** Points needed for one reward (the threshold), e.g. 9. */
  pointsPerReward: number;
  /** Human-readable reward, e.g. "Free regular coffee". */
  rewardDescription: string;
  /** Default points granted per purchase. */
  pointsPerPurchase: number;
  /** Safeguard: the most points a single accrual may grant. */
  maxPointsPerTransaction: number;
  /** Optional retention/expiry policy in days. 0 = disabled. */
  cardInactivityDays: number;
  /**
   * Session-revocation epoch (admin "sign out all devices"). A device's stored
   * session epoch is compared against this; anything older is forced to re-auth.
   * `undefined` is treated as 0 (no revocation has occurred). Never decreases.
   */
  sessionEpoch?: number;
  /**
   * Keys of suspicious-activity alerts an admin has acknowledged/dismissed.
   * Alerts are derived (not stored), so dismissal is recorded here and filtered
   * out of `getAlerts`. See `alertKey` in `domain/alerts.ts`.
   */
  dismissedAlerts?: string[];
}

export interface StaffAccount {
  id: string;
  username: string;
  /**
   * Display name used for staff attribution in the activity log, the staff
   * panel "on shift" line, and admin analytics. Distinct from `username` (the
   * sign-in handle). Optional for backward compatibility with seed/legacy
   * records; display falls back to `username` when absent.
   */
  name?: string;
  /**
   * Production stores a hash here. The prototype mocks auth and keeps a plain
   * value purely so the login screen has something to compare against; it must
   * never hold a real credential.
   */
  passwordHash: string;
  /**
   * Optional individual PIN for the staff sign-in screen (§6). Like
   * `passwordHash`, the prototype stores a plain value purely so the PIN pad has
   * something to compare against; production stores a hash verified server-side.
   * Absent for accounts created without a PIN.
   */
  pin?: string;
  role: StaffRole;
  active: boolean;
  createdAt: string;
}

export interface Customer {
  /** Internal id. Never leaves the system. */
  id: string;
  /** Random, opaque 128-bit token. This is what the QR/pass carries. */
  token: string;
  /**
   * Human-shareable Crockford-base32 handle (8 chars), unique per active card.
   * A camera-fail fallback (read aloud / typed) — NOT the identity (that's the
   * token). Assigned by the store on create.
   */
  shortCode: string;
  displayName?: string;
  email?: string;
  phone?: string;
  status: CustomerStatus;
  /** Timestamp the customer gave registration consent. */
  consentAt?: string;
  createdAt: string;
}

/**
 * Append-only ledger entry. The source of truth for points — balance is the
 * signed sum of these, never a stored counter.
 */
export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  type: TransactionType;
  /** Signed delta: +N accrual, −threshold redemption, ± reversal. */
  points: number;
  /** The staff member who committed the entry. */
  staffId: string;
  timestamp: string;
  note?: string;
  /** Set on `reversal` entries; points at the entry being undone. */
  reversesTransactionId?: string;
  /** Set on `reward_issue` entries (and their reversal): the {@link Reward} minted/voided. */
  rewardId?: string;
}

/**
 * Lifecycle status of a materialized {@link Reward}. `transfer_pending` is
 * RESERVED for gifting (deferred — schema-reserved only, see REWARDS-PLAN §6).
 */
export type RewardStatus = 'unspent' | 'spent' | 'voided' | 'transfer_pending';

/**
 * A discrete, countable, ownable reward — the rewards-as-objects model that
 * replaces the implicit `balance ≥ threshold` boolean.
 *
 * This is a MATERIALIZED PROJECTION: a cache for fast reads and a row to lock on
 * during a commit. The append-only {@link RewardEvent} log is the SOURCE OF TRUTH
 * for a reward's status — `status` here is derived from those events.
 */
export interface Reward {
  id: string;
  /** Random, opaque 128-bit token — carried in the reward QR. */
  token: string;
  /** Crockford-base32 short code — MANUAL / camera-fail path only. */
  shortCode: string;
  ownerId: string;
  status: RewardStatus;
  issuedAt: string;
  /** The `reward_issue` transaction that minted this reward. */
  sourceTxnId: string;
  /** `rewardDescription` captured at mint time, so history stays stable. */
  descriptionSnapshot: string;
  spentAt?: string;
  spentByStaffId?: string;
}

/**
 * Append-only reward-lifecycle event — the SOURCE OF TRUTH for a reward's status.
 * Reserved gifting kinds (transfer/pooled) are deferred (REWARDS-PLAN §6).
 */
export type RewardEventType = 'reward.issued' | 'reward.redeemed' | 'reward.voided';

export interface RewardEvent {
  id: string;
  rewardId: string;
  type: RewardEventType;
  customerId: string;
  staffId?: string;
  timestamp: string;
  /** Free-form context, e.g. `{ reason: 'mint_reversed' | 'undo_reissue' }`. Never PII. */
  details?: Record<string, string>;
}

/**
 * Canonical derived read-model for one customer (rewards-as-objects). Defined in
 * the domain so both the `DataStore` port and `LoyaltyService` can reference it
 * without inverting the layer dependency; `LoyaltyService` re-exports it.
 *
 * TRANSITIONAL (REWARDS-PLAN): `transactions` and `rewardAvailable` are retained
 * so pre-rework UI/services keep compiling. They are dropped once the service
 * rework (Phase 3) lands; `rewards` (the unspent-reward list, whose count drives
 * the card) is the replacement for the `rewardAvailable` boolean.
 */
export interface CustomerState {
  customer: Customer;
  config: ProgramConfig;
  /** @deprecated transitional — removed after the service rework (Phase 3). */
  transactions: LoyaltyTransaction[];
  /** Settles to 0..threshold−1 once rewards mint on crossing. */
  balance: number;
  /** @deprecated transitional — use `rewards` (the unspent count) instead. */
  rewardAvailable: boolean;
  /** Unspent rewards the customer owns; the count drives the card. */
  rewards?: Reward[];
  progress: { current: number; threshold: number; rewardsAvailable: number };
}

export type AuditAction =
  | 'staff.login'
  | 'staff.login.failed'
  | 'staff.create'
  | 'staff.disable'
  | 'staff.enable'
  | 'staff.delete'
  | 'staff.resetPassword'
  | 'card.issue'
  | 'card.reissue'
  | 'card.provision'
  | 'customer.register'
  | 'customer.recover'
  | 'customer.correct'
  | 'customer.delete'
  | 'loyalty.accrue'
  | 'loyalty.redeem'
  | 'loyalty.reverse'
  | 'config.update';

/**
 * Append-only action trail. Broader than the ledger: covers auth, staff/config
 * management and deletions in addition to loyalty entries.
 */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorRole: StaffRole | 'system';
  action: AuditAction;
  targetId?: string;
  /**
   * Free-form context. Must never contain PII (name/email/phone) — see CLAUDE.md.
   */
  details?: string;
  timestamp: string;
}

/** Full data snapshot for prototype JSON export/import. */
export interface Snapshot {
  version: number;
  exportedAt: string;
  config: ProgramConfig;
  staff: StaffAccount[];
  customers: Customer[];
  transactions: LoyaltyTransaction[];
  audit: AuditLogEntry[];
}
