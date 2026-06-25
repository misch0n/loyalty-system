/**
 * `DataStore` — the persistence seam.
 *
 * The whole app codes against this single async interface. Prototype wires the
 * IndexedDB adapter; production swaps in the HTTP adapter with NO call-site
 * changes. Every method returns a Promise even where IndexedDB could be sync —
 * this keeps prototype call sites byte-for-byte compatible with the future
 * (inherently async) HTTP adapter. Never write synchronous storage access.
 */

import type {
  AuditLogEntry,
  Customer,
  CustomerState,
  LoyaltyTransaction,
  ProgramConfig,
  Reward,
  RewardStatus,
  Snapshot,
  StaffAccount,
  StaffRole,
  TransactionType,
} from '../domain/models';

export interface CreateCustomerInput {
  token: string;
  displayName?: string;
  email?: string;
  phone?: string;
  consentAt?: string;
}

export type CustomerPatch = Partial<Pick<Customer, 'displayName' | 'email' | 'phone'>>;

export interface CustomerQuery {
  /** Free-text term matched against name/email/phone. */
  term: string;
}

export interface AppendTransactionInput {
  customerId: string;
  type: TransactionType;
  points: number;
  staffId: string;
  note?: string;
  reversesTransactionId?: string;
}

export interface RedeemResult {
  ok: boolean;
  reason?: string;
  transaction?: LoyaltyTransaction;
  /** Balance after the redemption (or the current balance on failure). */
  balance: number;
}

export interface CreateStaffInput {
  username: string;
  passwordHash: string;
  role: StaffRole;
  /** Display name (attribution + UI). Optional; falls back to username. */
  name?: string;
  /** Optional sign-in PIN (4–8 digits). Absent for password-only accounts. */
  pin?: string;
}

export interface AppendAuditInput {
  actorId: string;
  actorRole: AuditLogEntry['actorRole'];
  action: AuditLogEntry['action'];
  targetId?: string;
  details?: string;
}

export interface AuditFilter {
  action?: AuditLogEntry['action'];
  actorId?: string;
  limit?: number;
}

export interface CreateRecoveryCodeInput {
  code: string; // opaque random secret (the link/code value)
  customerId: string;
  expiresAt: number; // epoch ms
}

// ── rewards-as-objects: the unified commit contract (REWARDS-PLAN §3.3) ───────

/**
 * The single atomic mutation for the counter: accrue points, mint any rewards
 * crossed, and redeem 0..N existing rewards — all in one step, idempotent on
 * `idempotencyKey`. Replaces the separate accrue/redeem two-call flow.
 */
export interface CounterTransaction {
  customerId: string;
  /** Points to add: 0..`maxPointsPerTransaction` (over the cap ⇒ `over_cap`). */
  pointsDelta: number;
  /** Reward ids to redeem this commit: 0..10 (composite cap 10, hard 15). */
  redeemRewardIds: string[];
  staffId: string;
  /** Dedup key — a repeat with the same key returns the cached result, no re-writes. */
  idempotencyKey: string;
  /** Scan origin: 'a' = app camera, 'w' = wallet. Recorded on audit; drives nothing else. */
  source: 'a' | 'w';
}

/** A redeem id that failed re-validation at commit time; the rest still apply (subset redeem). */
export interface RejectedRedemption {
  rewardId: string;
  reason: 'not_owner' | 'already_spent' | 'reward_invalid';
}

/**
 * Outcome of {@link DataStore.commitCounterTransaction}. On success carries the
 * fresh derived state plus exactly what was minted/redeemed/rejected; on failure
 * a short-circuit error (no writes performed).
 */
export type CommitResult =
  | {
      ok: true;
      state: CustomerState;
      minted: Reward[];
      redeemed: Reward[];
      rejected: RejectedRedemption[];
    }
  | { ok: false; error: 'customer_not_found' | 'over_cap' };

export interface DataStore {
  // ── customers ────────────────────────────────────────────────────────────
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  getCustomerById(id: string): Promise<Customer | null>;
  getCustomerByToken(token: string): Promise<Customer | null>;
  /** Look up by the human-shareable short code (camera-fail fallback). */
  getCustomerByShortCode(shortCode: string): Promise<Customer | null>;
  findCustomers(query: CustomerQuery): Promise<Customer[]>;
  /** Staff-mediated correction only — never customer self-edit. */
  updateCustomer(id: string, patch: CustomerPatch): Promise<Customer>;
  /** Record registration consent (sets `consentAt`). */
  recordConsent(id: string, consentAt: string): Promise<Customer>;
  /** Rotate the opaque token (reissue). Returns the updated customer. */
  rotateToken(id: string, token: string): Promise<Customer>;
  softDeleteCustomer(id: string): Promise<void>;

  // ── loyalty (append-only) ──────────────────────────────────────────────────
  appendTransaction(tx: AppendTransactionInput): Promise<LoyaltyTransaction>;
  listTransactions(customerId: string): Promise<LoyaltyTransaction[]>;
  /**
   * Atomic check-balance-then-write to prevent double-spend.
   *
   * TRANSITIONAL: the pre-rework redeem path. The rewards-as-objects model
   * (REWARDS-PLAN) replaces it with {@link DataStore.commitCounterTransaction};
   * this signature is removed once that lands.
   */
  redeemReward(customerId: string, staffId: string): Promise<RedeemResult>;

  // ── rewards-as-objects (unified commit, REWARDS-PLAN §3.3) ──────────────────
  /**
   * The single atomic mutation entry: accrual + mint-on-cross + redeem-N in one
   * IDB readwrite tx, idempotent on `txn.idempotencyKey`. Replaces the separate
   * `appendTransaction`(accrual)/`redeemReward` two-call flow.
   */
  commitCounterTransaction(txn: CounterTransaction): Promise<CommitResult>;
  /** Materialized rewards for a customer, optionally filtered by status. */
  listRewards(customerId: string, status?: RewardStatus): Promise<Reward[]>;
  /** Full derived read-model: settled balance + unspent rewards. */
  getCustomerState(customerId: string): Promise<CustomerState>;
  /**
   * Reverse a commit within the undo window: reverse the points, void any
   * freshly-minted (unspent) reward, and re-mint a replacement for each reward
   * spent in that commit. A spent reward is never un-spent.
   */
  undoCommit(idempotencyKey: string): Promise<CommitResult>;

  // ── staff & config ─────────────────────────────────────────────────────────
  createStaff(input: CreateStaffInput): Promise<StaffAccount>;
  getStaffByUsername(username: string): Promise<StaffAccount | null>;
  /**
   * Find the single active staff account whose PIN matches (PIN sign-in, §6).
   * Returns null when no active account has that PIN. PINs are unique among
   * accounts that have one.
   */
  getStaffByPin(pin: string): Promise<StaffAccount | null>;
  setStaffActive(id: string, active: boolean): Promise<void>;
  setStaffPassword(id: string, passwordHash: string): Promise<void>;
  /** Set/replace an account's sign-in PIN. PINs are unique among active accounts. */
  setStaffPin(id: string, pin: string): Promise<void>;
  /** Permanently remove a staff/admin account. Audit history keeps the actor id. */
  deleteStaff(id: string): Promise<void>;
  listStaff(): Promise<StaffAccount[]>;
  getConfig(): Promise<ProgramConfig>;
  updateConfig(patch: Partial<ProgramConfig>): Promise<ProgramConfig>;

  // ── recovery codes (single-use, short-expiry) ──────────────────────────────
  createRecoveryCode(input: CreateRecoveryCodeInput): Promise<void>;
  /**
   * Atomically validate + consume a recovery code. Returns the customerId if the
   * code exists, is unused, and is unexpired (marking it used in the same
   * transaction); otherwise returns null. Single-use: a second consume returns null.
   */
  consumeRecoveryCode(code: string): Promise<string | null>;

  // ── audit ──────────────────────────────────────────────────────────────────
  appendAudit(entry: AppendAuditInput): Promise<void>;
  listAudit(filter?: AuditFilter): Promise<AuditLogEntry[]>;

  // ── stats (basic counts only) ───────────────────────────────────────────────
  countActiveCustomers(): Promise<number>;
  listAllTransactions(): Promise<LoyaltyTransaction[]>;

  // ── backup/restore (prototype: JSON export/import) ──────────────────────────
  exportAll(): Promise<Snapshot>;
  importAll(snapshot: Snapshot): Promise<void>;
}
