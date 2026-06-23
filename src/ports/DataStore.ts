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
  LoyaltyTransaction,
  ProgramConfig,
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

export interface DataStore {
  // ── customers ────────────────────────────────────────────────────────────
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  getCustomerById(id: string): Promise<Customer | null>;
  getCustomerByToken(token: string): Promise<Customer | null>;
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
  /** Atomic check-balance-then-write to prevent double-spend. */
  redeemReward(customerId: string, staffId: string): Promise<RedeemResult>;

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
