/**
 * `DataStore` — the persistence seam.
 *
 * The whole app codes against this single async interface. Every method returns
 * a Promise; never write synchronous storage access.
 *
 * ## What this interface is, after Phase 6
 *
 * There is now exactly **one** store — `PostgresStore`, behind the HTTP API —
 * and the IndexedDB adapter that used to sit beside it is gone. So this file
 * stopped being "the shape two adapters agree on" and became **the shape a
 * client may ask for over an untrusted network**. That reframing is what the
 * Phase 6 reshape is: BACKEND-PLAN §4 listed six methods that were safe as
 * in-process calls and unsafe as HTTP ones, and every one of them had been
 * worked around at the route boundary because this file could not be edited.
 * It can now, so the methods say what they mean:
 *
 *   - `setStaffPassword` takes the **plaintext** credential, because that is
 *     what it has always been handed; the store hashes it (§4-A). Same for
 *     `CreateStaffInput`.
 *   - `getStaffByPin` is **gone** — a global "which account has this PIN?" is a
 *     credential oracle over HTTP (§4-B). Re-auth verifies a PIN against the
 *     account the session already names.
 *   - `appendAudit` and the recovery-code methods moved to {@link TrustedStore},
 *     below: capabilities a client must never hold (§4-C, and the recovery twin
 *     of §4-B).
 *   - `CommitResult` says whether it was `replayed`, so a caller no longer has
 *     to read the idempotency table behind the store's back.
 *   - `redeemReward` is **gone** — the pre-rework redeem path, replaced by
 *     `commitCounterTransaction` and refused by the schema.
 *
 * `listAllTransactions` and `exportAll` are still "fetch everything" (§4-E);
 * that one stays a route-boundary concern, because the same calls feed
 * in-process readers (the detectors, the stats derivation) that a silently
 * truncated read would make quietly wrong.
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
} from '../domain/models.js';

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

export interface CreateStaffInput {
  username: string;
  /**
   * The **plaintext** password, which the store hashes (argon2id) before it is
   * written. It was called `passwordHash` until Phase 6, and no caller ever
   * passed a hash — BACKEND-PLAN §4-A: had a store stored what that name
   * promised, the "hash" *would be* the password.
   */
  password: string;
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

/**
 * Audit query. Singular `action`/`actorId` are the everyday reads; the plural
 * `actions`/`actorIds` and the `from`/`to` range back the admin investigation
 * export (Appendix E). Within a field the values are OR'd; across fields they
 * are AND'd. A singular and its plural may both be given — the union applies.
 */
export interface AuditFilter {
  action?: AuditLogEntry['action'];
  /** Match any of these actions (OR). Combined with `action` as a union. */
  actions?: AuditLogEntry['action'][];
  actorId?: string;
  /** Match any of these actors (OR). Combined with `actorId` as a union. */
  actorIds?: string[];
  /** Inclusive lower bound, ISO timestamp. */
  from?: string;
  /** Inclusive upper bound, ISO timestamp. */
  to?: string;
  limit?: number;
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
      /**
       * True when this call was served from the idempotency cache rather than
       * writing anything — a retry of a commit that already happened.
       *
       * The caller needs it because the *side effects around* the commit are not
       * idempotent by themselves: the route writes the audit rows and sends the
       * reward-available mail, and a retry must do neither. Until Phase 6 the
       * route answered that question by reading `idempotency_keys` directly
       * (`isCommitReplay`), because saying so here meant editing this file.
       */
      replayed: boolean;
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

  // ── rewards-as-objects (unified commit, REWARDS-PLAN §3.3) ──────────────────
  /**
   * The single atomic mutation entry: accrual + mint-on-cross + redeem-N in one
   * database transaction, idempotent on `txn.idempotencyKey`. Replaces the
   * separate accrue/redeem two-call flow the rewards rework retired.
   */
  commitCounterTransaction(txn: CounterTransaction): Promise<CommitResult>;
  /** Materialized rewards for a customer, optionally filtered by status. */
  listRewards(customerId: string, status?: RewardStatus): Promise<Reward[]>;
  /** Full derived read-model: settled balance + unspent rewards. */
  getCustomerState(customerId: string): Promise<CustomerState>;

  // ── staff & config ─────────────────────────────────────────────────────────
  createStaff(input: CreateStaffInput): Promise<StaffAccount>;
  getStaffByUsername(username: string): Promise<StaffAccount | null>;
  setStaffActive(id: string, active: boolean): Promise<void>;
  /**
   * Set an account's password from the **plaintext**, which the store hashes.
   *
   * Phase 6 renamed the parameter from `passwordHash` (BACKEND-PLAN §4-A). The
   * old name was the most dangerous line in this file: it invited a store to
   * write what it was handed, which would have made the stored digest a
   * working credential for anyone who could read the database. There is no
   * client-side hashing anywhere in this system — the plaintext travels over
   * TLS and is hashed at rest, once, here.
   */
  setStaffPassword(id: string, password: string): Promise<void>;
  /** Set/replace an account's sign-in PIN, from the plaintext. Hashed at rest. */
  setStaffPin(id: string, pin: string): Promise<void>;
  /** Permanently remove a staff/admin account. Audit history keeps the actor id. */
  deleteStaff(id: string): Promise<void>;
  listStaff(): Promise<StaffAccount[]>;
  getConfig(): Promise<ProgramConfig>;
  updateConfig(patch: Partial<ProgramConfig>): Promise<ProgramConfig>;

  // ── audit ──────────────────────────────────────────────────────────────────
  /**
   * Read the audit log. Writing it is not on this interface — see
   * {@link TrustedStore.appendAudit}.
   *
   * No caller may read *another* account's rows over HTTP: `GET /audit`
   * replaces whatever actor filter the request carries with the session's own,
   * at every tier (BACKEND-PLAN §4-F). The unrestricted filter exists for the
   * in-process readers — the detectors — and is why the ceiling on `limit` is
   * enforced at the route rather than here.
   */
  listAudit(filter?: AuditFilter): Promise<AuditLogEntry[]>;

  // ── stats (basic counts only) ───────────────────────────────────────────────
  countActiveCustomers(): Promise<number>;
  listAllTransactions(): Promise<LoyaltyTransaction[]>;

  // ── backup/restore (JSON export/import) ─────────────────────────────────────
  exportAll(): Promise<Snapshot>;
  importAll(snapshot: Snapshot): Promise<void>;
}

/**
 * `TrustedStore` — the capabilities a **client may not have**.
 *
 * Everything on {@link DataStore} is something a browser is allowed to ask for,
 * because a route stands in front of it deciding who may. These three are not:
 * they are in-process calls whose integrity comes from the caller being the
 * server itself, and each one, exposed over HTTP, would hand a client the exact
 * thing the design withholds.
 *
 *   - **`appendAudit`** — a client-supplied actor and action. A client-writable
 *     audit log is not an audit log (BACKEND-PLAN §4-C). Route handlers write
 *     their own rows; `POST /audit` answers 204 and writes nothing.
 *   - **the recovery-code pair** — the recovery twin of §4-B. A client cannot be
 *     trusted to name the customer a code belongs to, which is precisely what
 *     makes the code safe: a guess is checked against the codes issued to *that
 *     customer*, never against every live code in the table. The route resolves
 *     the address to a customer itself and never tells the caller whether it
 *     found one.
 *
 * Splitting them out is the honest version of a rule the routes were already
 * enforcing by hand. Before Phase 6 they sat on `DataStore` with guardrail tests
 * greping for callers; now the type says it, and an adapter that speaks HTTP
 * simply cannot implement this interface.
 */
export interface TrustedStore extends DataStore {
  /** Append an audit row. The caller is trusted to have derived the actor itself. */
  appendAudit(entry: AppendAuditInput): Promise<void>;

  /**
   * Issue a recovery code for a customer and return the **plaintext** — the only
   * moment it exists outside the mail. Supersedes any code still live for that
   * customer, so a caller cannot stack live codes to widen the target.
   */
  createRecoveryCode(customerId: string): Promise<string>;

  /**
   * Validate and consume `code` **for this customer**, atomically. True when it
   * was live, unexpired and under the attempt limit; false otherwise, including
   * a second consume of the same code.
   *
   * Scoped by `customerId` by design: "consume whatever code this is" carried
   * its own security when the code was a 128-bit token, and carries none now
   * that it is six typed characters (SCOPE-DECISIONS §2.3).
   */
  consumeRecoveryCode(customerId: string, code: string): Promise<boolean>;

  /**
   * Count a wrong guess against every code live for this customer, burning any
   * that reach the limit. Durable on purpose: restarting the process must not
   * buy a guesser five more attempts.
   */
  recordFailedRecoveryAttempt(customerId: string): Promise<void>;
}
