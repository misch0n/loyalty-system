/**
 * `PostgresStore` — the one store.
 *
 * Phase 6 retired `IndexedDbStore`, so this is no longer "the production half of
 * a pair": it is the implementation, and
 * `tests/conformance/dataStoreConformance.ts` — written to prove two stores
 * agreed — is now simply its specification.
 *
 * What Postgres gave us over IndexedDB is integrity the browser could not:
 * unique short codes and emails among *active* cards, foreign keys, append-only
 * triggers, and — the one that matters most — a real row lock.
 * `commitCounterTransaction` takes `SELECT … FOR UPDATE` on the customer row, so
 * two tills committing at the same instant serialize instead of interleaving.
 * That closes STATUS divergence `l`.
 *
 * Deliberately thin: hand-written SQL, no ORM (BACKEND-PLAN §2). The commit is
 * the one piece of logic that has to be *obvious*.
 *
 * Deliberate behaviours, each load-bearing rather than incidental:
 *   • **Credentials are hashed here** (argon2id), never stored as given —
 *     BACKEND-PLAN §4-A. The port's `password`/`pin` parameters carry the
 *     plaintext; whatever the client sends *is* the credential, so hashing it is
 *     the store's job, not the caller's. (Phase 6 renamed those parameters: they
 *     used to say `passwordHash`, and no caller ever passed a hash.)
 *   • **`softDeleteCustomer` erases the token and short code too**
 *     (SCOPE-DECISIONS §3.3) — the dead token can never be scanned again, and
 *     the email is freed for re-registration.
 *   • **A tombstone cannot be committed against.** A deleted card is not a
 *     customer; it keeps its history and gains none.
 *
 * It implements {@link TrustedStore}, not just `DataStore`: appending audit rows
 * and issuing recovery codes are in-process capabilities no client-side adapter
 * may hold, and since Phase 6 the type says so rather than a guardrail test.
 */

import type {
  AppendAuditInput,
  AppendTransactionInput,
  AuditFilter,
  CommitResult,
  CounterTransaction,
  CreateCustomerInput,
  CreateStaffInput,
  CustomerPatch,
  CustomerQuery,
  RejectedRedemption,
  TrustedStore,
} from '@cafe/shared/ports/DataStore';
import type {
  AuditLogEntry,
  Customer,
  CustomerState,
  LoyaltyTransaction,
  ProgramConfig,
  Reward,
  RewardEvent,
  RewardStatus,
  Snapshot,
  StaffAccount,
} from '@cafe/shared/domain/models';
import {
  generateId,
  generateRewardShortCode,
  generateRewardToken,
  generateShortCode,
} from '@cafe/shared/domain/tokens';
import { balance } from '@cafe/shared/domain/loyalty';
import { cardProgress, isOverCap, mintFold, validateRedemption } from '@cafe/shared/domain/rewards';
import { normalizeEmail, normalizePhone } from '@cafe/shared/domain/validation';
import type { Db, Queryable } from './db';
import { withTransaction } from './db';
import { hashSecret } from './hashing';
import { consumeRecoveryCode, issueRecoveryCode, recordFailedAttempt } from './recovery/codes';

// ── row shapes ────────────────────────────────────────────────────────────────

interface CustomerRow {
  id: string;
  token: string | null;
  short_code: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  status: Customer['status'];
  consent_at: Date | null;
  created_at: Date;
}

interface TransactionRow {
  id: string;
  customer_id: string;
  type: LoyaltyTransaction['type'];
  points: number;
  staff_id: string;
  timestamp: Date;
  note: string | null;
  reverses_transaction_id: string | null;
  reward_id: string | null;
}

interface RewardRow {
  id: string;
  token: string;
  short_code: string;
  owner_id: string;
  status: RewardStatus;
  issued_at: Date;
  source_txn_id: string;
  description_snapshot: string;
  spent_at: Date | null;
  spent_by_staff_id: string | null;
}

interface RewardEventRow {
  id: string;
  reward_id: string;
  type: RewardEvent['type'];
  customer_id: string;
  staff_id: string | null;
  timestamp: Date;
  details: Record<string, string> | null;
}

interface StaffRow {
  id: string;
  username: string;
  name: string | null;
  password_hash: string;
  pin_hash: string | null;
  role: StaffAccount['role'];
  active: boolean;
  created_at: Date;
}

interface AuditRow {
  id: string;
  actor_id: string;
  actor_role: AuditLogEntry['actorRole'];
  action: AuditLogEntry['action'];
  target_id: string | null;
  details: string | null;
  timestamp: Date;
}

interface ConfigRow {
  points_per_reward: number;
  reward_description: string;
  points_per_purchase: number;
  max_points_per_transaction: number;
  card_inactivity_days: number;
  session_epoch: number;
  dismissed_alerts: string[];
  self_deal_window_sec: number;
  self_deal_count: number;
  repeat_count: number;
  repeat_window_min: number;
}

const CUSTOMER_COLUMNS =
  'id, token, short_code, display_name, email, phone, status, consent_at, created_at';
const TRANSACTION_COLUMNS =
  'id, customer_id, type, points, staff_id, timestamp, note, reverses_transaction_id, reward_id';
const REWARD_COLUMNS =
  'id, token, short_code, owner_id, status, issued_at, source_txn_id, description_snapshot, spent_at, spent_by_staff_id';
const REWARD_EVENT_COLUMNS = 'id, reward_id, type, customer_id, staff_id, timestamp, details';
const STAFF_COLUMNS = 'id, username, name, password_hash, pin_hash, role, active, created_at';
const AUDIT_COLUMNS = 'id, actor_id, actor_role, action, target_id, details, timestamp';
const CONFIG_COLUMNS = `points_per_reward, reward_description, points_per_purchase,
  max_points_per_transaction, card_inactivity_days, session_epoch, dismissed_alerts,
  self_deal_window_sec, self_deal_count, repeat_count, repeat_window_min`;

/**
 * Snapshot format version. It describes the JSON shape, not the database schema.
 *
 * Bumped to 7 in Phase 6, when `Snapshot` gained `rewards` and `rewardEvents`
 * (BACKEND-PLAN §3-A-6). A version-6 file is a config-and-ledger backup that
 * silently lost every materialized reward; a reader that meets one should know
 * it is looking at an incomplete restore, which is what the number is for.
 */
const SNAPSHOT_VERSION = 7;

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505';

/** Thrown to roll back a commit that lost an idempotency-key race; never escapes. */
class DuplicateCommit extends Error {}

function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : undefined;
}

/** `null` → `undefined`: the domain types use optional fields, Postgres uses NULL. */
function opt<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

function iso(value: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

/** Escape a user term for LIKE, then wrap it in wildcards. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

// ── mappers ───────────────────────────────────────────────────────────────────

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    // A tombstone has no token/short code (SCOPE-DECISIONS §3.3). The domain
    // type requires them, so the erased values surface as empty strings rather
    // than as a lie about a live card.
    token: row.token ?? '',
    shortCode: row.short_code ?? '',
    displayName: opt(row.display_name),
    email: opt(row.email),
    phone: opt(row.phone),
    status: row.status,
    consentAt: iso(row.consent_at),
    createdAt: row.created_at.toISOString(),
  };
}

function toTransaction(row: TransactionRow): LoyaltyTransaction {
  return {
    id: row.id,
    customerId: row.customer_id,
    type: row.type,
    points: row.points,
    staffId: row.staff_id,
    timestamp: row.timestamp.toISOString(),
    note: opt(row.note),
    reversesTransactionId: opt(row.reverses_transaction_id),
    rewardId: opt(row.reward_id),
  };
}

function toReward(row: RewardRow): Reward {
  return {
    id: row.id,
    token: row.token,
    shortCode: row.short_code,
    ownerId: row.owner_id,
    status: row.status,
    issuedAt: row.issued_at.toISOString(),
    sourceTxnId: row.source_txn_id,
    descriptionSnapshot: row.description_snapshot,
    spentAt: iso(row.spent_at),
    spentByStaffId: opt(row.spent_by_staff_id),
  };
}

function toRewardEvent(row: RewardEventRow): RewardEvent {
  return {
    id: row.id,
    rewardId: row.reward_id,
    type: row.type,
    customerId: row.customer_id,
    staffId: opt(row.staff_id),
    timestamp: row.timestamp.toISOString(),
    details: opt(row.details),
  };
}

function toStaff(row: StaffRow): StaffAccount {
  return {
    id: row.id,
    username: row.username,
    name: opt(row.name),
    // The argon2id digest. `StaffAccount.passwordHash`/`pin` are documented as
    // holding a hash in production; routes must never serialize either (Phase 4).
    passwordHash: row.password_hash,
    pin: opt(row.pin_hash),
    role: row.role,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

function toAudit(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    action: row.action,
    targetId: opt(row.target_id),
    details: opt(row.details),
    timestamp: row.timestamp.toISOString(),
  };
}

function toConfig(row: ConfigRow): ProgramConfig {
  return {
    pointsPerReward: row.points_per_reward,
    rewardDescription: row.reward_description,
    pointsPerPurchase: row.points_per_purchase,
    maxPointsPerTransaction: row.max_points_per_transaction,
    cardInactivityDays: row.card_inactivity_days,
    sessionEpoch: row.session_epoch,
    dismissedAlerts: row.dismissed_alerts,
    selfDealWindowSec: row.self_deal_window_sec,
    selfDealCount: row.self_deal_count,
    repeatCount: row.repeat_count,
    repeatWindowMin: row.repeat_window_min,
  };
}

/** `ProgramConfig` field → its column, for the dynamic `updateConfig` patch. */
const CONFIG_FIELD_COLUMNS: Record<keyof ProgramConfig, string> = {
  pointsPerReward: 'points_per_reward',
  rewardDescription: 'reward_description',
  pointsPerPurchase: 'points_per_purchase',
  maxPointsPerTransaction: 'max_points_per_transaction',
  cardInactivityDays: 'card_inactivity_days',
  sessionEpoch: 'session_epoch',
  dismissedAlerts: 'dismissed_alerts',
  selfDealWindowSec: 'self_deal_window_sec',
  selfDealCount: 'self_deal_count',
  repeatCount: 'repeat_count',
  repeatWindowMin: 'repeat_window_min',
};

// ── the store ─────────────────────────────────────────────────────────────────

export class PostgresStore implements TrustedStore {
  constructor(private readonly db: Db) {}

  private now(): string {
    return new Date().toISOString();
  }

  // ── customers ───────────────────────────────────────────────────────────────

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const id = generateId();
    const createdAt = this.now();

    // Short codes collide at roughly 1 in 10^12, but the unique index means a
    // collision is an error rather than a silent duplicate — so retry on exactly
    // that constraint and let every other violation (token, email) propagate.
    for (let attempt = 0; ; attempt++) {
      try {
        const { rows } = await this.db.query<CustomerRow>(
          `INSERT INTO customers (${CUSTOMER_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
           RETURNING ${CUSTOMER_COLUMNS}`,
          [
            id,
            input.token,
            generateShortCode(),
            input.displayName ?? null,
            input.email ?? null,
            input.phone ?? null,
            input.consentAt ?? null,
            createdAt,
          ],
        );
        return toCustomer(required(rows[0], 'Customer insert returned no row.'));
      } catch (err) {
        const retryable =
          pgErrorCode(err) === UNIQUE_VIOLATION &&
          pgConstraint(err) === 'customers_short_code_active_key' &&
          attempt < 12;
        if (!retryable) throw err;
      }
    }
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    return this.oneCustomer('id = $1', [id]);
  }

  async getCustomerByToken(token: string): Promise<Customer | null> {
    if (!token) return null;
    return this.oneCustomer('token = $1', [token]);
  }

  async getCustomerByShortCode(shortCode: string): Promise<Customer | null> {
    if (!shortCode) return null;
    return this.oneCustomer('short_code = $1', [shortCode]);
  }

  private async oneCustomer(where: string, params: unknown[]): Promise<Customer | null> {
    const { rows } = await this.db.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE ${where}`,
      params,
    );
    const row = rows[0];
    return row ? toCustomer(row) : null;
  }

  async findCustomers(query: CustomerQuery): Promise<Customer[]> {
    const term = query.term.trim().toLowerCase();
    if (!term) return [];
    // Same three-way match as the prototype: name substring, normalized email
    // substring, digits-only phone substring. Deleted cards never match — a
    // tombstone has nothing left to match on anyway.
    const phoneTerm = normalizePhone(term);
    const { rows } = await this.db.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers
        WHERE status = 'active'
          AND ( lower(display_name) LIKE $1
             OR lower(email) LIKE $2
             OR ($3::text IS NOT NULL
                 AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE $3) )
        ORDER BY created_at, id`,
      [
        likeContains(term),
        likeContains(normalizeEmail(term)),
        phoneTerm ? likeContains(phoneTerm) : null,
      ],
    );
    return rows.map(toCustomer);
  }

  async updateCustomer(id: string, patch: CustomerPatch): Promise<Customer> {
    return this.patchCustomer(id, {
      display_name: patch.displayName,
      email: patch.email,
      phone: patch.phone,
    });
  }

  async recordConsent(id: string, consentAt: string): Promise<Customer> {
    return this.patchCustomer(id, { consent_at: consentAt });
  }

  async rotateToken(id: string, token: string): Promise<Customer> {
    return this.patchCustomer(id, { token });
  }

  /** Applies only the keys actually present, mirroring the prototype's spread. */
  private async patchCustomer(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Customer> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      const current = await this.getCustomerById(id);
      if (!current) throw new Error('Customer not found.');
      return current;
    }
    const assignments = entries.map(([column], i) => `${column} = $${i + 2}`);
    const { rows } = await this.db.query<CustomerRow>(
      `UPDATE customers SET ${assignments.join(', ')} WHERE id = $1
       RETURNING ${CUSTOMER_COLUMNS}`,
      [id, ...entries.map(([, value]) => value)],
    );
    const row = rows[0];
    if (!row) throw new Error('Customer not found.');
    return toCustomer(row);
  }

  /**
   * Tombstone the card (SCOPE-DECISIONS §3.3): keep `id`, `createdAt` and
   * `status` so the ledger stays internally consistent and shop totals stay
   * correct; erase everything that resolves to a person. Erasing the token means
   * the dead card can never be scanned again, and erasing the email frees the
   * address for a fresh registration starting at zero.
   */
  async softDeleteCustomer(id: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE customers
          SET status = 'deleted', deleted_at = now(),
              token = NULL, short_code = NULL,
              display_name = NULL, email = NULL, phone = NULL
        WHERE id = $1`,
      [id],
    );
    if (!rowCount) throw new Error('Customer not found.');
  }

  // ── loyalty (append-only) ───────────────────────────────────────────────────

  async appendTransaction(input: AppendTransactionInput): Promise<LoyaltyTransaction> {
    const { rows } = await this.db.query<TransactionRow>(
      `INSERT INTO loyalty_transactions
         (id, customer_id, type, points, staff_id, timestamp, note, reverses_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${TRANSACTION_COLUMNS}`,
      [
        generateId(),
        input.customerId,
        input.type,
        input.points,
        input.staffId,
        this.now(),
        input.note ?? null,
        input.reversesTransactionId ?? null,
      ],
    );
    return toTransaction(required(rows[0], 'Transaction insert returned no row.'));
  }

  async listTransactions(customerId: string): Promise<LoyaltyTransaction[]> {
    return this.readTransactions(this.db, customerId);
  }

  private async readTransactions(
    db: Queryable,
    customerId: string,
  ): Promise<LoyaltyTransaction[]> {
    // `id` breaks ties so the order is deterministic: the accrual and the
    // `reward_issue` minted beside it share one timestamp by design.
    const { rows } = await db.query<TransactionRow>(
      `SELECT ${TRANSACTION_COLUMNS} FROM loyalty_transactions
        WHERE customer_id = $1 ORDER BY timestamp, id`,
      [customerId],
    );
    return rows.map(toTransaction);
  }

  // ── rewards-as-objects (the unified, atomic commit) ─────────────────────────

  /**
   * The single atomic mutation: accrue, mint a reward per threshold crossing,
   * and redeem 0..N existing rewards — one SQL transaction, idempotent on
   * `idempotencyKey`.
   *
   * The customer row is taken `FOR UPDATE` before anything is read or written,
   * so two tills scanning the same card serialize: the second reads the first's
   * committed balance instead of the balance it saw a moment ago. This is the
   * guarantee IndexedDB could not make (STATUS divergence `l`) — its transaction
   * scope bounds a single connection, not two devices.
   *
   * Audit is NOT written here; the route writes it in the same transaction
   * (Phase 4), which is where the actor is known to be genuine.
   */
  async commitCounterTransaction(txn: CounterTransaction): Promise<CommitResult> {
    const cached = await this.readCommitResult(this.db, txn.idempotencyKey);
    if (cached) return cached;

    try {
      return await withTransaction(this.db, (tx) => this.runCommit(tx, txn));
    } catch (err) {
      // Two identical commits raced past the cache read above. The loser rolled
      // back, so nothing was written twice; replay the winner's result.
      if (err instanceof DuplicateCommit) {
        const replay = await this.readCommitResult(this.db, txn.idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }
  }

  private async runCommit(tx: Queryable, txn: CounterTransaction): Promise<CommitResult> {
    const config = await this.readConfig(tx);

    // over_cap short-circuit (no writes) — checked first, as in the prototype.
    if (isOverCap(txn.pointsDelta, config)) return { ok: false, error: 'over_cap' };

    // The lock. Everything below reads and writes under it.
    const { rows: customerRows } = await tx.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers
        WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [txn.customerId],
    );
    const customerRow = customerRows[0];
    // A tombstone is not a customer: it keeps its history and gains none.
    if (!customerRow) return { ok: false, error: 'customer_not_found' };

    // Re-check under the lock: a same-key retry that slipped past the cache read
    // waits here, then finds the winner's row.
    const raced = await this.readCommitResult(tx, txn.idempotencyKey);
    if (raced) return raced;

    const now = this.now();
    const { rows: balanceRows } = await tx.query<{ balance: string }>(
      'SELECT COALESCE(SUM(points), 0) AS balance FROM loyalty_transactions WHERE customer_id = $1',
      [txn.customerId],
    );
    const startBalance = Number(required(balanceRows[0], 'Balance query returned no row.').balance);

    // 1. Accrual. A redeem-only commit adds no ledger entry.
    if (txn.pointsDelta > 0) {
      await tx.query(
        `INSERT INTO loyalty_transactions (id, customer_id, type, points, staff_id, timestamp)
         VALUES ($1, $2, 'accrual', $3, $4, $5)`,
        [generateId(), txn.customerId, txn.pointsDelta, txn.staffId, now],
      );
    }

    // 2. Mint-on-cross. The fold handles a single large accrual crossing twice.
    const minted: Reward[] = [];
    const plan = mintFold(startBalance + txn.pointsDelta, config);
    for (let i = 0; i < plan.mintCount; i++) {
      minted.push(
        await this.mintReward(
          tx,
          txn.customerId,
          txn.staffId,
          config.rewardDescription,
          plan.perMintPoints,
          now,
        ),
      );
    }

    // 3. Subset redeem: re-validate each id against the live row; an invalid one
    //    is reported and never aborts the commit.
    const redeemed: Reward[] = [];
    const rejected: RejectedRedemption[] = [];
    if (txn.redeemRewardIds.length > 0) {
      // Lock the whole set in id order first, so two commits redeeming
      // overlapping sets can never take the rows in opposite orders and deadlock.
      await tx.query('SELECT id FROM rewards WHERE id = ANY($1) ORDER BY id FOR UPDATE', [
        [...new Set(txn.redeemRewardIds)].sort(),
      ]);
    }
    for (const rewardId of txn.redeemRewardIds) {
      const { rows } = await tx.query<RewardRow>(
        `SELECT ${REWARD_COLUMNS} FROM rewards WHERE id = $1`,
        [rewardId],
      );
      const row = rows[0];
      const reward = row ? toReward(row) : null;
      const validity = validateRedemption(reward, txn.customerId);
      if (!validity.ok) {
        rejected.push({ rewardId, reason: validity.reason });
        continue;
      }
      const { rows: spentRows } = await tx.query<RewardRow>(
        `UPDATE rewards SET status = 'spent', spent_at = $2, spent_by_staff_id = $3
          WHERE id = $1 RETURNING ${REWARD_COLUMNS}`,
        [rewardId, now, txn.staffId],
      );
      await this.appendRewardEvent(tx, 'reward.redeemed', rewardId, txn.customerId, txn.staffId, now);
      redeemed.push(toReward(required(spentRows[0], 'Reward update returned no row.')));
    }

    const state = this.buildState(
      toCustomer(customerRow),
      config,
      await this.readTransactions(tx, txn.customerId),
      await this.readRewards(tx, txn.customerId),
    );
    const result: CommitResult = { ok: true, state, minted, redeemed, rejected, replayed: false };

    const inserted = await tx.query(
      'INSERT INTO idempotency_keys (key, result) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [txn.idempotencyKey, JSON.stringify(result)],
    );
    if (!inserted.rowCount) throw new DuplicateCommit();

    return result;
  }

  /**
   * The cached result for an idempotency key, or null if this key is new.
   *
   * `replayed` is stamped on the way *out* rather than stored, so the cached
   * JSON is exactly what the first caller was told and every later caller is
   * told the same thing plus "this already happened". The route needs that
   * because the work it does *around* the commit — the audit rows, the
   * reward-available mail — is not idempotent on its own, and a retry must do
   * neither (BACKEND-PLAN §4-C). Before Phase 6 it read `idempotency_keys`
   * itself to find out, because `CommitResult` could not say.
   */
  private async readCommitResult(db: Queryable, key: string): Promise<CommitResult | null> {
    const { rows } = await db.query<{ result: CommitResult }>(
      'SELECT result FROM idempotency_keys WHERE key = $1',
      [key],
    );
    const row = rows[0];
    if (!row) return null;
    return row.result.ok ? { ...row.result, replayed: true } : row.result;
  }

  /**
   * Mint one reward: its `reward_issue(−threshold)` ledger entry, the
   * materialized {@link Reward}, and the `reward.issued` event that is the
   * source of truth for its status.
   */
  private async mintReward(
    tx: Queryable,
    customerId: string,
    staffId: string,
    description: string,
    ledgerDelta: number,
    now: string,
  ): Promise<Reward> {
    const rewardId = generateId();
    const sourceTxnId = generateId();
    await tx.query(
      `INSERT INTO loyalty_transactions
         (id, customer_id, type, points, staff_id, timestamp, reward_id)
       VALUES ($1, $2, 'reward_issue', $3, $4, $5, $6)`,
      [sourceTxnId, customerId, ledgerDelta, staffId, now, rewardId],
    );

    // Same bounded retry as a customer short code, but a failed INSERT aborts
    // the whole enclosing transaction — so each attempt runs inside a savepoint
    // and only the attempt is rolled back.
    for (let attempt = 0; ; attempt++) {
      await tx.query('SAVEPOINT mint');
      try {
        const { rows } = await tx.query<RewardRow>(
          `INSERT INTO rewards
             (id, token, short_code, owner_id, status, issued_at, source_txn_id, description_snapshot)
           VALUES ($1, $2, $3, $4, 'unspent', $5, $6, $7)
           RETURNING ${REWARD_COLUMNS}`,
          [
            rewardId,
            generateRewardToken(),
            generateRewardShortCode(),
            customerId,
            now,
            sourceTxnId,
            description,
          ],
        );
        await this.appendRewardEvent(tx, 'reward.issued', rewardId, customerId, staffId, now);
        await tx.query('RELEASE SAVEPOINT mint');
        return toReward(required(rows[0], 'Reward insert returned no row.'));
      } catch (err) {
        await tx.query('ROLLBACK TO SAVEPOINT mint');
        const constraint = pgConstraint(err);
        const retryable =
          pgErrorCode(err) === UNIQUE_VIOLATION &&
          (constraint === 'rewards_short_code_key' || constraint === 'rewards_token_key') &&
          attempt < 12;
        if (!retryable) throw err;
      }
    }
  }

  private async appendRewardEvent(
    tx: Queryable,
    type: 'reward.issued' | 'reward.redeemed' | 'reward.voided',
    rewardId: string,
    customerId: string,
    staffId: string | undefined,
    now: string,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO reward_events (id, reward_id, type, customer_id, staff_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [generateId(), rewardId, type, customerId, staffId ?? null, now],
    );
  }

  async listRewards(customerId: string, status?: RewardStatus): Promise<Reward[]> {
    return this.readRewards(this.db, customerId, status);
  }

  private async readRewards(
    db: Queryable,
    customerId: string,
    status?: RewardStatus,
  ): Promise<Reward[]> {
    const { rows } = await db.query<RewardRow>(
      `SELECT ${REWARD_COLUMNS} FROM rewards
        WHERE owner_id = $1 AND ($2::text IS NULL OR status = $2)
        ORDER BY issued_at, id`,
      [customerId, status ?? null],
    );
    return rows.map(toReward);
  }

  async getCustomerState(customerId: string): Promise<CustomerState> {
    const customer = await this.getCustomerById(customerId);
    if (!customer) throw new Error('Customer not found.');
    const [config, transactions, rewards] = await Promise.all([
      this.readConfig(this.db),
      this.readTransactions(this.db, customerId),
      this.readRewards(this.db, customerId),
    ]);
    return this.buildState(customer, config, transactions, rewards);
  }

  /**
   * The canonical derived read-model. Identical derivation to the prototype
   * adapter — it is pure `domain/` logic, shared verbatim, which is exactly why
   * both stores can answer the same conformance suite.
   */
  private buildState(
    customer: Customer,
    config: ProgramConfig,
    transactions: LoyaltyTransaction[],
    rewards: Reward[],
  ): CustomerState {
    const bal = balance(transactions);
    const prog = cardProgress(bal, config);
    const unspent = rewards.filter((r) => r.status === 'unspent');
    return {
      customer,
      config,
      transactions,
      balance: bal,
      rewardAvailable: unspent.length > 0,
      rewards: unspent,
      progress: {
        current: prog.current,
        threshold: prog.threshold,
        rewardsAvailable: unspent.length,
      },
    };
  }

  // ── staff & config ──────────────────────────────────────────────────────────

  /**
   * BACKEND-PLAN §4-A: `password` and `pin` are **plaintext** — whatever reaches
   * the server is the secret — so they are hashed here with argon2id and the
   * plaintext is never stored. The input field was called `passwordHash` until
   * Phase 6, which is the same fact told as a lie.
   */
  async createStaff(input: CreateStaffInput): Promise<StaffAccount> {
    const [passwordHash, pinHash] = await Promise.all([
      hashSecret(input.password),
      input.pin ? hashSecret(input.pin) : Promise.resolve(null),
    ]);
    const { rows } = await this.db.query<StaffRow>(
      `INSERT INTO staff_accounts (id, username, name, password_hash, pin_hash, role, active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING ${STAFF_COLUMNS}`,
      [generateId(), input.username, input.name ?? null, passwordHash, pinHash, input.role, this.now()],
    );
    return toStaff(required(rows[0], 'Staff insert returned no row.'));
  }

  async getStaffByUsername(username: string): Promise<StaffAccount | null> {
    const { rows } = await this.db.query<StaffRow>(
      `SELECT ${STAFF_COLUMNS} FROM staff_accounts WHERE lower(username) = lower($1)`,
      [username],
    );
    const row = rows[0];
    return row ? toStaff(row) : null;
  }

  // `getStaffByPin` is deliberately absent, and Phase 6 took it off the port
  // rather than leaving it implemented with a guardrail test warning nobody to
  // call it. A global "which account has this PIN?" search is an unauthenticated
  // credential oracle over HTTP, brute-forceable across the whole staff table at
  // four digits (BACKEND-PLAN §4-B). PIN re-auth is `POST /auth/unlock`, which
  // verifies a PIN against the account this device's session already names.

  async setStaffActive(id: string, active: boolean): Promise<void> {
    await this.updateStaff(id, 'active = $2', [active]);
  }

  async setStaffPassword(id: string, password: string): Promise<void> {
    await this.updateStaff(id, 'password_hash = $2', [await hashSecret(password)]);
  }

  async setStaffPin(id: string, pin: string): Promise<void> {
    await this.updateStaff(id, 'pin_hash = $2', [await hashSecret(pin)]);
  }

  private async updateStaff(id: string, assignment: string, params: unknown[]): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE staff_accounts SET ${assignment} WHERE id = $1`,
      [id, ...params],
    );
    if (!rowCount) throw new Error('Staff account not found.');
  }

  async deleteStaff(id: string): Promise<void> {
    // No cascade into the ledger or the audit log: attribution has to survive a
    // deleted account, which is why neither carries an FK to it.
    await this.db.query('DELETE FROM staff_accounts WHERE id = $1', [id]);
  }

  async listStaff(): Promise<StaffAccount[]> {
    const { rows } = await this.db.query<StaffRow>(
      `SELECT ${STAFF_COLUMNS} FROM staff_accounts ORDER BY username`,
    );
    return rows.map(toStaff);
  }

  async getConfig(): Promise<ProgramConfig> {
    return this.readConfig(this.db);
  }

  private async readConfig(db: Queryable): Promise<ProgramConfig> {
    const { rows } = await db.query<ConfigRow>(
      `SELECT ${CONFIG_COLUMNS} FROM program_config WHERE id = 'singleton'`,
    );
    // Migration 001 seeds the singleton, so its absence means an unmigrated
    // database. Failing beats quietly serving a default the admin never chose.
    return toConfig(
      required(rows[0], 'program_config is empty — has the database been migrated?'),
    );
  }

  async updateConfig(patch: Partial<ProgramConfig>): Promise<ProgramConfig> {
    const entries = (Object.keys(CONFIG_FIELD_COLUMNS) as (keyof ProgramConfig)[])
      .filter((field) => patch[field] !== undefined)
      .map((field) => [CONFIG_FIELD_COLUMNS[field], patch[field]] as const);

    if (entries.length === 0) return this.getConfig();

    const assignments = entries.map(([column], i) => `${column} = $${i + 1}`);
    const { rows } = await this.db.query<ConfigRow>(
      `UPDATE program_config SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = 'singleton' RETURNING ${CONFIG_COLUMNS}`,
      entries.map(([, value]) => value),
    );
    return toConfig(required(rows[0], 'program_config is empty — has the database been migrated?'));
  }

  // ── recovery codes (single-use, short-expiry) ───────────────────────────────

  /**
   * The recovery trio, all three delegating to `recovery/codes.ts` — which is
   * where the reasoning lives, and where it always was.
   *
   * Until Phase 6 there were two implementations: the port's prototype-shaped
   * pair here (`consumeRecoveryCode(code)` — a lookup by value across the whole
   * table) and the scoped one in `recovery/codes.ts` that the routes actually
   * use, with a guardrail test forbidding anything from calling the first. The
   * port now carries the scoped shape, so there is one implementation and the
   * guardrail has nothing left to forbid: the signature itself refuses to look a
   * code up without naming whose it is.
   *
   * These are on {@link TrustedStore}, not `DataStore`: a client that could name
   * the customer could name someone else's.
   */
  async createRecoveryCode(customerId: string): Promise<string> {
    return issueRecoveryCode(this.db, customerId, () => Date.parse(this.now()));
  }

  async consumeRecoveryCode(customerId: string, code: string): Promise<boolean> {
    return consumeRecoveryCode(this.db, customerId, code);
  }

  async recordFailedRecoveryAttempt(customerId: string): Promise<void> {
    await recordFailedAttempt(this.db, customerId);
  }

  // ── audit ───────────────────────────────────────────────────────────────────

  async appendAudit(entry: AppendAuditInput): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (id, actor_id, actor_role, action, target_id, details, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        generateId(),
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.targetId ?? null,
        entry.details ?? null,
        this.now(),
      ],
    );
  }

  /**
   * The ranged, multi-value audit query. Within a field values are OR'd, across
   * fields AND'd, and a singular filter unions with its plural — matching
   * `AuditFilter` exactly. Indexed on `(timestamp)`, `(action, timestamp)` and
   * `(actor_id, timestamp)`.
   *
   * SCOPE-DECISIONS §3.1 / §4 Q5: this is an **internal** capability feeding the
   * two detectors. No route is attached to it and none may be — deliberately no
   * ceiling is clamped on here either, because silently truncating the
   * detectors' input would make them wrong; the boundary limit belongs on the
   * route (Phase 4), where the caller is known.
   */
  async listAudit(filter: AuditFilter = {}): Promise<AuditLogEntry[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    const actions = [...new Set([...(filter.actions ?? []), ...(filter.action ? [filter.action] : [])])];
    if (actions.length > 0) {
      params.push(actions);
      where.push(`action = ANY($${params.length})`);
    }

    const actors = [...new Set([...(filter.actorIds ?? []), ...(filter.actorId ? [filter.actorId] : [])])];
    if (actors.length > 0) {
      params.push(actors);
      where.push(`actor_id = ANY($${params.length})`);
    }

    if (filter.from) {
      params.push(filter.from);
      where.push(`timestamp >= $${params.length}::timestamptz`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`timestamp <= $${params.length}::timestamptz`);
    }

    let sql = `SELECT ${AUDIT_COLUMNS} FROM audit_log`;
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY timestamp DESC, id DESC';
    if (filter.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }

    const { rows } = await this.db.query<AuditRow>(sql, params);
    return rows.map(toAudit);
  }

  // ── stats (basic counts only) ───────────────────────────────────────────────

  async countActiveCustomers(): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      "SELECT count(*) AS count FROM customers WHERE status = 'active'",
    );
    return Number(required(rows[0], 'Count query returned no row.').count);
  }

  /**
   * BACKEND-PLAN §4-E: unbounded here by design, because this is also the
   * in-process read the stats derivation uses. The date range and page cap are a
   * route-boundary concern (Phase 4) — a store that silently truncated would
   * make every derived total quietly wrong.
   */
  async listAllTransactions(): Promise<LoyaltyTransaction[]> {
    const { rows } = await this.db.query<TransactionRow>(
      `SELECT ${TRANSACTION_COLUMNS} FROM loyalty_transactions ORDER BY timestamp, id`,
    );
    return rows.map(toTransaction);
  }

  // ── backup/restore ──────────────────────────────────────────────────────────

  /**
   * Everything a restore needs, as JSON.
   *
   * `rewards` and `rewardEvents` are here since Phase 6 (BACKEND-PLAN §3-A-6):
   * without them a restore brought back the ledger and silently dropped the free
   * coffee a customer was owed. `recoveryCodes` is *not*, and that is a decision
   * rather than the same gap left open — see {@link Snapshot}.
   *
   * Credentials are blanked by the route, not here, because an in-process caller
   * restoring a database wants the digests and a file on someone's laptop must
   * not carry them.
   */
  async exportAll(): Promise<Snapshot> {
    const [config, staff, customers, transactions, rewards, rewardEvents, audit] = await Promise.all([
      this.getConfig(),
      this.listStaff(),
      this.db
        .query<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers ORDER BY created_at, id`)
        .then((r) => r.rows.map(toCustomer)),
      this.listAllTransactions(),
      this.db
        .query<RewardRow>(`SELECT ${REWARD_COLUMNS} FROM rewards ORDER BY issued_at, id`)
        .then((r) => r.rows.map(toReward)),
      this.db
        .query<RewardEventRow>(
          `SELECT ${REWARD_EVENT_COLUMNS} FROM reward_events ORDER BY timestamp, id`,
        )
        .then((r) => r.rows.map(toRewardEvent)),
      this.db
        .query<AuditRow>(`SELECT ${AUDIT_COLUMNS} FROM audit_log ORDER BY timestamp, id`)
        .then((r) => r.rows.map(toAudit)),
    ]);
    return {
      version: SNAPSHOT_VERSION,
      exportedAt: this.now(),
      config,
      staff,
      customers,
      transactions,
      rewards,
      rewardEvents,
      audit,
    };
  }

  /**
   * Replace everything with the snapshot's contents.
   *
   * Rewards and their event log are restored since Phase 6. Recovery codes are
   * not carried by a snapshot and so are simply cleared — every code in a file
   * old enough to be restored expired long before (see {@link Snapshot}), along
   * with sessions and the idempotency cache, which are live state rather than
   * data.
   *
   * A pre-Phase-6 (version 6) file has no `rewards`/`rewardEvents` at all; it
   * restores as it always did, minus those tables, rather than being refused.
   *
   * TRUNCATE rather than DELETE is what makes this possible at all: the
   * append-only triggers on the ledger and audit log reject row deletes, and
   * they must — a restore is a whole-database replacement, not an edit of
   * history.
   */
  async importAll(snapshot: Snapshot): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await tx.query(`TRUNCATE sessions, recovery_codes, idempotency_keys, reward_events,
                               rewards, loyalty_transactions, audit_log, customers, staff_accounts`);

      const config = snapshot.config;
      await tx.query(
        `UPDATE program_config SET
           points_per_reward = $1, reward_description = $2, points_per_purchase = $3,
           max_points_per_transaction = $4, card_inactivity_days = $5,
           session_epoch = $6, dismissed_alerts = $7,
           self_deal_window_sec = $8, self_deal_count = $9,
           repeat_count = $10, repeat_window_min = $11, updated_at = now()
         WHERE id = 'singleton'`,
        [
          config.pointsPerReward,
          config.rewardDescription,
          config.pointsPerPurchase,
          config.maxPointsPerTransaction,
          config.cardInactivityDays,
          config.sessionEpoch ?? 0,
          config.dismissedAlerts ?? [],
          config.selfDealWindowSec ?? 30,
          config.selfDealCount ?? 3,
          config.repeatCount ?? 3,
          config.repeatWindowMin ?? 30,
        ],
      );

      for (const s of snapshot.staff) {
        await tx.query(
          `INSERT INTO staff_accounts (id, username, name, password_hash, pin_hash, role, active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [s.id, s.username, s.name ?? null, s.passwordHash, s.pin ?? null, s.role, s.active, s.createdAt],
        );
      }

      for (const c of snapshot.customers) {
        const deleted = c.status === 'deleted';
        await tx.query(
          `INSERT INTO customers (${CUSTOMER_COLUMNS}, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            c.id,
            deleted ? null : c.token,
            deleted ? null : c.shortCode,
            deleted ? null : c.displayName ?? null,
            deleted ? null : c.email ?? null,
            deleted ? null : c.phone ?? null,
            c.status,
            c.consentAt ?? null,
            c.createdAt,
            deleted ? c.createdAt : null,
          ],
        );
      }

      // Reversals reference the entry they reverse, so the referenced entry has
      // to land first; everything else is insertion-order independent.
      const ordered = [...snapshot.transactions].sort(
        (a, b) => Number(a.type === 'reversal') - Number(b.type === 'reversal'),
      );
      for (const t of ordered) {
        await tx.query(
          `INSERT INTO loyalty_transactions
             (id, customer_id, type, points, staff_id, timestamp, note, reverses_transaction_id, reward_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            t.id,
            t.customerId,
            t.type,
            t.points,
            t.staffId,
            t.timestamp,
            t.note ?? null,
            t.reversesTransactionId ?? null,
            t.rewardId ?? null,
          ],
        );
      }

      // Rewards before their events: `reward_events.reward_id` is an FK.
      for (const r of snapshot.rewards ?? []) {
        await tx.query(
          `INSERT INTO rewards (${REWARD_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            r.id,
            r.token,
            r.shortCode,
            r.ownerId,
            r.status,
            r.issuedAt,
            r.sourceTxnId,
            r.descriptionSnapshot,
            r.spentAt ?? null,
            r.spentByStaffId ?? null,
          ],
        );
      }

      for (const e of snapshot.rewardEvents ?? []) {
        await tx.query(
          `INSERT INTO reward_events (${REWARD_EVENT_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [e.id, e.rewardId, e.type, e.customerId, e.staffId ?? null, e.timestamp, e.details ?? null],
        );
      }

      for (const a of snapshot.audit) {
        await tx.query(
          `INSERT INTO audit_log (id, actor_id, actor_role, action, target_id, details, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [a.id, a.actorId, a.actorRole, a.action, a.targetId ?? null, a.details ?? null, a.timestamp],
        );
      }
    });
  }
}

/** `noUncheckedIndexedAccess` guard: a query that must have returned a row. */
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
