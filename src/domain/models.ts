/**
 * Entity types — the shared vocabulary of the whole system.
 *
 * Pure types only: no behaviour, no I/O. These move/share directly into the
 * production Node backend (the `domain/` and `ports/` layers are stack-agnostic).
 */

export type StaffRole = 'admin' | 'staff';
export type CustomerStatus = 'active' | 'deleted';
export type TransactionType = 'accrual' | 'redemption' | 'reversal';

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
}

export type AuditAction =
  | 'staff.login'
  | 'staff.login.failed'
  | 'staff.create'
  | 'staff.disable'
  | 'staff.enable'
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
