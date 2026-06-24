/**
 * IndexedDbStore — the prototype `DataStore` implementation.
 *
 * Implements the full persistence contract against IndexedDB (via `idb`). It is
 * the ONLY storage code in the prototype; everything above it speaks the async
 * `DataStore` interface, so swapping in `ApiStore` for production touches no
 * call sites.
 *
 * Note: browser storage is NOT secure storage. This adapter is for demo/testing
 * only and must never hold real customer data.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type {
  AppendAuditInput,
  AppendTransactionInput,
  AuditFilter,
  CreateCustomerInput,
  CreateRecoveryCodeInput,
  CreateStaffInput,
  CustomerPatch,
  CustomerQuery,
  DataStore,
  RedeemResult,
} from '../../ports/DataStore';
import type {
  AuditLogEntry,
  Customer,
  LoyaltyTransaction,
  ProgramConfig,
  Snapshot,
  StaffAccount,
} from '../../domain/models';
import { generateId, generateShortCode } from '../../domain/tokens';
import { balance, checkRedemption } from '../../domain/loyalty';
import { normalizeEmail, normalizePhone } from '../../domain/validation';
import {
  CONFIG_KEY,
  DB_NAME,
  DB_VERSION,
  DEFAULT_CONFIG,
  LEGACY_POINTS_PER_REWARD,
  SEED_STAFF,
  type LoyaltyDB,
  type RecoveryCodeRecord,
} from './schema';
import { buildDemoSeed } from './demoSeed';

export class IndexedDbStore implements DataStore {
  private dbPromise: Promise<IDBPDatabase<LoyaltyDB>>;
  /** Seed demo customers/ledger/audit on a fresh DB (prototype only — off in tests). */
  private readonly withDemoData: boolean;

  constructor(opts: { seedDemo?: boolean } = {}) {
    this.withDemoData = opts.seedDemo ?? false;
    this.dbPromise = this.open();
  }

  /** Close the underlying connection so a prototype reset can delete the DB. */
  async close(): Promise<void> {
    const db = await this.dbPromise;
    db.close();
  }

  /**
   * Prototype reset: empty every store on the LIVE connection and re-seed —
   * deliberately NOT `deleteDatabase` + reopen. `deleteDatabase` can hang
   * silently in Safari (no success/error/blocked event ever fires), leaving the
   * store on a dead connection until a page reload — the real cause of "after a
   * reset the dev panel shows nothing and card creation fails until a reload".
   * Clearing in place keeps the same open connection, so the store is usable the
   * instant this resolves; no close, no delete, no reopen, nothing that can hang.
   */
  async reset(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(
      ['config', 'staff', 'customers', 'transactions', 'audit', 'recoveryCodes'],
      'readwrite',
    );
    await Promise.all([
      tx.objectStore('config').clear(),
      tx.objectStore('staff').clear(),
      tx.objectStore('customers').clear(),
      tx.objectStore('transactions').clear(),
      tx.objectStore('audit').clear(),
      tx.objectStore('recoveryCodes').clear(),
    ]);
    await tx.done;
    await this.seed(db); // re-run the idempotent seed: default config + mock staff
  }

  /** Watchdog timeouts (ms). A blocked/stalled open never settles on its own, so
   *  we bound it and recover rather than hang every later call forever. */
  private static readonly OPEN_TIMEOUT_MS = 5_000;
  private static readonly DELETE_TIMEOUT_MS = 3_000;

  private async open(): Promise<IDBPDatabase<LoyaltyDB>> {
    let db: IDBPDatabase<LoyaltyDB>;
    try {
      db = await this.openOnce();
    } catch {
      // A wedged or incompatible database — a half-applied migration, or an open
      // that never resolves because another browser context is blocking the
      // upgrade — makes EVERY later call hang (the real cause of "card creation
      // stuck / dev panel shows no data / reset does nothing"). Prototype data is
      // disposable and re-seeded just below, so delete and reopen once, fresh.
      await this.deleteDb();
      db = await this.openOnce();
    }

    await this.seed(db);
    await this.backfillShortCodes(db);
    return db;
  }

  /** openDB wrapped in a watchdog + self-release handlers, so a blocked/stalled
   *  open rejects (letting `open()` delete + retry) instead of hanging. */
  private openOnce(): Promise<IDBPDatabase<LoyaltyDB>> {
    let opened: IDBPDatabase<LoyaltyDB> | undefined;
    const opening = openDB<LoyaltyDB>(DB_NAME, DB_VERSION, {
      async upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          database.createObjectStore('config', { keyPath: 'id' });

          const staff = database.createObjectStore('staff', { keyPath: 'id' });
          staff.createIndex('byUsername', 'username', { unique: true });

          const customers = database.createObjectStore('customers', { keyPath: 'id' });
          customers.createIndex('byToken', 'token', { unique: true });
          customers.createIndex('byStatus', 'status');
          customers.createIndex('byShortCode', 'shortCode', { unique: true });

          const transactions = database.createObjectStore('transactions', { keyPath: 'id' });
          transactions.createIndex('byCustomer', 'customerId');

          const audit = database.createObjectStore('audit', { keyPath: 'id' });
          audit.createIndex('byTimestamp', 'timestamp');
          audit.createIndex('byAction', 'action');
        }
        if (oldVersion < 2) {
          // Recovery codes keyed by the opaque code itself (no PII stored).
          database.createObjectStore('recoveryCodes', { keyPath: 'code' });
        }
        if (oldVersion < 3 && oldVersion >= 1) {
          // The program default changed from 10 → 8 coffees (the card shows a
          // fixed 10-stamp layout: welcome + 8 purchases + free). Nudge devices
          // still on the old default so they pick up the new program; a custom
          // (non-legacy) threshold an admin set is left untouched.
          const store = transaction.objectStore('config');
          const cfg = await store.get(CONFIG_KEY);
          if (cfg && cfg.pointsPerReward === LEGACY_POINTS_PER_REWARD) {
            await store.put({ ...cfg, pointsPerReward: DEFAULT_CONFIG.pointsPerReward });
          }
        }
        if (oldVersion < 4 && oldVersion >= 1) {
          // Add the human-shareable short code index. Existing rows have no
          // `shortCode` (so they're simply absent from this unique index until
          // backfilled). Backfill runs AFTER open in a normal transaction —
          // never here: awaiting a cursor loop inside a versionchange upgrade can
          // hang the transaction on Safari, which then blocks every DB op.
          transaction.objectStore('customers').createIndex('byShortCode', 'shortCode', {
            unique: true,
          });
        }
      },
      blocked() {
        // Another open connection is holding back our upgrade. We can't proceed;
        // the watchdog below times out and open() deletes + retries.
      },
      blocking() {
        // We are blocking ANOTHER context's upgrade — release our connection so
        // neither side deadlocks (e.g. a second tab / home-screen instance).
        opened?.close();
      },
      terminated() {
        // Safari can drop the connection out from under us; nothing to do here —
        // the next call recreates the store on a fresh connection.
      },
    }).then((d) => {
      opened = d;
      return d;
    });
    return IndexedDbStore.withTimeout(opening, IndexedDbStore.OPEN_TIMEOUT_MS);
  }

  /** Best-effort delete that itself can't hang (Safari can stall deleteDatabase). */
  private deleteDb(): Promise<void> {
    const del = new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
    return IndexedDbStore.withTimeout(del, IndexedDbStore.DELETE_TIMEOUT_MS).catch(() => undefined);
  }

  /** Reject `p` if it hasn't settled within `ms` — turns an infinite hang into a
   *  recoverable error. */
  private static withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IndexedDB operation timed out')), ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  /**
   * Assign a unique short code to any customer missing one (e.g. cards created
   * before schema v4). Runs in a NORMAL transaction after open — safe, unlike a
   * backfill inside the versionchange upgrade. Idempotent: a no-op once all
   * customers have codes.
   */
  private async backfillShortCodes(db: IDBPDatabase<LoyaltyDB>): Promise<void> {
    const all = await db.getAll('customers');
    const missing = all.filter((c) => !c.shortCode);
    if (missing.length === 0) return;
    const used = new Set(all.map((c) => c.shortCode).filter(Boolean));
    const tx = db.transaction('customers', 'readwrite');
    for (const c of missing) {
      let code = generateShortCode();
      while (used.has(code)) code = generateShortCode();
      used.add(code);
      await tx.store.put({ ...c, shortCode: code });
    }
    await tx.done;
  }

  /** Idempotent first-run seed: default config + mock staff accounts. */
  private async seed(db: IDBPDatabase<LoyaltyDB>): Promise<void> {
    const existingConfig = await db.get('config', CONFIG_KEY);
    if (!existingConfig) {
      await db.put('config', { ...DEFAULT_CONFIG, id: CONFIG_KEY });
    }
    const staffCount = await db.count('staff');
    if (staffCount === 0) {
      const tx = db.transaction('staff', 'readwrite');
      for (const member of SEED_STAFF) await tx.store.put(member);
      await tx.done;
      // First run (or post-Reset): seed demo data so the admin stat breakdowns
      // have content across ranges. Prototype-only (off in tests).
      if (this.withDemoData) await this.seedDemo(db);
    }
  }

  /** Write the prototype demo members/ledger/audit (see demoSeed.ts). */
  private async seedDemo(db: IDBPDatabase<LoyaltyDB>): Promise<void> {
    const { customers, transactions, audit } = buildDemoSeed(Date.now());
    const tx = db.transaction(['customers', 'transactions', 'audit'], 'readwrite');
    for (const c of customers) await tx.objectStore('customers').put(c);
    for (const t of transactions) await tx.objectStore('transactions').put(t);
    for (const a of audit) await tx.objectStore('audit').put(a);
    await tx.done;
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── customers ──────────────────────────────────────────────────────────────

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const db = await this.dbPromise;
    const customer: Customer = {
      id: generateId(),
      token: input.token,
      shortCode: await this.allocateShortCode(db),
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
      status: 'active',
      consentAt: input.consentAt,
      createdAt: this.now(),
    };
    await db.add('customers', customer);
    return customer;
  }

  /** A short code not already taken by another card (collisions are vanishingly rare). */
  private async allocateShortCode(db: IDBPDatabase<LoyaltyDB>): Promise<string> {
    for (let i = 0; i < 12; i++) {
      const code = generateShortCode();
      try {
        if (!(await db.getFromIndex('customers', 'byShortCode', code))) return code;
      } catch {
        // Index unavailable for some reason — accept the code (collision odds are
        // ~1 in 10^12). Never let card creation hang/fail on the lookup.
        return code;
      }
    }
    return generateShortCode();
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    const db = await this.dbPromise;
    return (await db.get('customers', id)) ?? null;
  }

  async getCustomerByToken(token: string): Promise<Customer | null> {
    const db = await this.dbPromise;
    return (await db.getFromIndex('customers', 'byToken', token)) ?? null;
  }

  async getCustomerByShortCode(shortCode: string): Promise<Customer | null> {
    if (!shortCode) return null;
    const db = await this.dbPromise;
    return (await db.getFromIndex('customers', 'byShortCode', shortCode)) ?? null;
  }

  async findCustomers(query: CustomerQuery): Promise<Customer[]> {
    const db = await this.dbPromise;
    const term = query.term.trim().toLowerCase();
    if (!term) return [];
    const emailTerm = normalizeEmail(term);
    const phoneTerm = normalizePhone(term);
    const all = await db.getAll('customers');
    return all.filter((c) => {
      if (c.status !== 'active') return false;
      if (c.displayName && c.displayName.toLowerCase().includes(term)) return true;
      if (c.email && normalizeEmail(c.email).includes(emailTerm)) return true;
      if (phoneTerm && c.phone && normalizePhone(c.phone).includes(phoneTerm)) return true;
      return false;
    });
  }

  async updateCustomer(id: string, patch: CustomerPatch): Promise<Customer> {
    const db = await this.dbPromise;
    const tx = db.transaction('customers', 'readwrite');
    const current = await tx.store.get(id);
    if (!current) throw new Error('Customer not found.');
    const updated: Customer = { ...current, ...patch };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async recordConsent(id: string, consentAt: string): Promise<Customer> {
    return this.updateCustomerRaw(id, { consentAt });
  }

  async rotateToken(id: string, token: string): Promise<Customer> {
    return this.updateCustomerRaw(id, { token });
  }

  private async updateCustomerRaw(
    id: string,
    patch: Partial<Customer>,
  ): Promise<Customer> {
    const db = await this.dbPromise;
    const tx = db.transaction('customers', 'readwrite');
    const current = await tx.store.get(id);
    if (!current) throw new Error('Customer not found.');
    const updated: Customer = { ...current, ...patch };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async softDeleteCustomer(id: string): Promise<void> {
    // Clear PII and mark deleted; the ledger/audit history stays for integrity.
    await this.updateCustomerRaw(id, {
      status: 'deleted',
      displayName: undefined,
      email: undefined,
      phone: undefined,
    });
  }

  // ── loyalty (append-only) ──────────────────────────────────────────────────

  async appendTransaction(input: AppendTransactionInput): Promise<LoyaltyTransaction> {
    const db = await this.dbPromise;
    const tx: LoyaltyTransaction = {
      id: generateId(),
      customerId: input.customerId,
      type: input.type,
      points: input.points,
      staffId: input.staffId,
      timestamp: this.now(),
      note: input.note,
      reversesTransactionId: input.reversesTransactionId,
    };
    await db.add('transactions', tx);
    return tx;
  }

  async listTransactions(customerId: string): Promise<LoyaltyTransaction[]> {
    const db = await this.dbPromise;
    const txs = await db.getAllFromIndex('transactions', 'byCustomer', customerId);
    return txs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async redeemReward(customerId: string, staffId: string): Promise<RedeemResult> {
    const db = await this.dbPromise;
    // Single IndexedDB transaction spanning config + ledger = atomic check+write.
    const tx = db.transaction(['transactions', 'config'], 'readwrite');
    const configRecord = await tx.objectStore('config').get(CONFIG_KEY);
    const config: ProgramConfig = configRecord ?? DEFAULT_CONFIG;

    const ledger = await tx
      .objectStore('transactions')
      .index('byCustomer')
      .getAll(customerId);
    const current = balance(ledger);

    const decision = checkRedemption(current, config);
    if (!decision.ok) {
      await tx.done;
      return { ok: false, reason: decision.reason, balance: current };
    }

    const entry: LoyaltyTransaction = {
      id: generateId(),
      customerId,
      type: 'redemption',
      points: decision.delta,
      staffId,
      timestamp: this.now(),
      note: config.rewardDescription,
    };
    await tx.objectStore('transactions').add(entry);
    await tx.done;

    return { ok: true, transaction: entry, balance: current + decision.delta };
  }

  // ── recovery codes (single-use, short-expiry) ──────────────────────────────

  async createRecoveryCode(input: CreateRecoveryCodeInput): Promise<void> {
    const db = await this.dbPromise;
    const record: RecoveryCodeRecord = {
      code: input.code,
      customerId: input.customerId,
      expiresAt: input.expiresAt,
    };
    await db.add('recoveryCodes', record);
  }

  async consumeRecoveryCode(code: string): Promise<string | null> {
    const db = await this.dbPromise;
    // Single IndexedDB transaction = atomic check (exists/unused/unexpired)
    // plus mark-used write, mirroring redeemReward's no-double-spend pattern.
    const tx = db.transaction('recoveryCodes', 'readwrite');
    const record = await tx.store.get(code);
    if (!record || record.usedAt !== undefined || record.expiresAt <= Date.now()) {
      await tx.done;
      return null;
    }
    await tx.store.put({ ...record, usedAt: Date.now() });
    await tx.done;
    return record.customerId;
  }

  // ── staff & config ──────────────────────────────────────────────────────────

  async createStaff(input: CreateStaffInput): Promise<StaffAccount> {
    const db = await this.dbPromise;
    const account: StaffAccount = {
      id: generateId(),
      username: input.username,
      name: input.name,
      passwordHash: input.passwordHash,
      pin: input.pin,
      role: input.role,
      active: true,
      createdAt: this.now(),
    };
    await db.add('staff', account);
    return account;
  }

  async getStaffByUsername(username: string): Promise<StaffAccount | null> {
    const db = await this.dbPromise;
    return (await db.getFromIndex('staff', 'byUsername', username)) ?? null;
  }

  async getStaffByPin(pin: string): Promise<StaffAccount | null> {
    if (!pin) return null;
    const db = await this.dbPromise;
    // PIN is not indexed (it's a credential, kept off the index surface). Scan
    // the small staff set for the one active account whose PIN matches.
    const all = await db.getAll('staff');
    return all.find((s) => s.active && s.pin === pin) ?? null;
  }

  async setStaffActive(id: string, active: boolean): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('staff', 'readwrite');
    const current = await tx.store.get(id);
    if (!current) throw new Error('Staff account not found.');
    await tx.store.put({ ...current, active });
    await tx.done;
  }

  async setStaffPassword(id: string, passwordHash: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('staff', 'readwrite');
    const current = await tx.store.get(id);
    if (!current) throw new Error('Staff account not found.');
    await tx.store.put({ ...current, passwordHash });
    await tx.done;
  }

  async setStaffPin(id: string, pin: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('staff', 'readwrite');
    const current = await tx.store.get(id);
    if (!current) throw new Error('Staff account not found.');
    await tx.store.put({ ...current, pin });
    await tx.done;
  }

  async deleteStaff(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('staff', id);
  }

  async listStaff(): Promise<StaffAccount[]> {
    const db = await this.dbPromise;
    const all = await db.getAll('staff');
    return all.sort((a, b) => a.username.localeCompare(b.username));
  }

  async getConfig(): Promise<ProgramConfig> {
    const db = await this.dbPromise;
    const record = await db.get('config', CONFIG_KEY);
    if (!record) return DEFAULT_CONFIG;
    const { id: _id, ...config } = record;
    return config;
  }

  async updateConfig(patch: Partial<ProgramConfig>): Promise<ProgramConfig> {
    const db = await this.dbPromise;
    const tx = db.transaction('config', 'readwrite');
    const record = (await tx.store.get(CONFIG_KEY)) ?? { ...DEFAULT_CONFIG, id: CONFIG_KEY };
    const updated = { ...record, ...patch, id: CONFIG_KEY };
    await tx.store.put(updated);
    await tx.done;
    const { id: _id, ...config } = updated;
    return config;
  }

  // ── audit ────────────────────────────────────────────────────────────────────

  async appendAudit(input: AppendAuditInput): Promise<void> {
    const db = await this.dbPromise;
    const entry: AuditLogEntry = {
      id: generateId(),
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetId: input.targetId,
      details: input.details,
      timestamp: this.now(),
    };
    await db.add('audit', entry);
  }

  async listAudit(filter: AuditFilter = {}): Promise<AuditLogEntry[]> {
    const db = await this.dbPromise;
    let entries = await db.getAll('audit');
    if (filter.action) entries = entries.filter((e) => e.action === filter.action);
    if (filter.actorId) entries = entries.filter((e) => e.actorId === filter.actorId);
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // newest first
    if (filter.limit) entries = entries.slice(0, filter.limit);
    return entries;
  }

  // ── stats ─────────────────────────────────────────────────────────────────────

  async countActiveCustomers(): Promise<number> {
    const db = await this.dbPromise;
    return db.countFromIndex('customers', 'byStatus', 'active');
  }

  async listAllTransactions(): Promise<LoyaltyTransaction[]> {
    const db = await this.dbPromise;
    return db.getAll('transactions');
  }

  // ── backup/restore ─────────────────────────────────────────────────────────────

  async exportAll(): Promise<Snapshot> {
    const db = await this.dbPromise;
    const [config, staff, customers, transactions, audit] = await Promise.all([
      this.getConfig(),
      db.getAll('staff'),
      db.getAll('customers'),
      db.getAll('transactions'),
      db.getAll('audit'),
    ]);
    return {
      version: DB_VERSION,
      exportedAt: this.now(),
      config,
      staff,
      customers,
      transactions,
      audit,
    };
  }

  async importAll(snapshot: Snapshot): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(
      ['config', 'staff', 'customers', 'transactions', 'audit'],
      'readwrite',
    );
    await Promise.all([
      tx.objectStore('config').clear(),
      tx.objectStore('staff').clear(),
      tx.objectStore('customers').clear(),
      tx.objectStore('transactions').clear(),
      tx.objectStore('audit').clear(),
    ]);
    await tx.objectStore('config').put({ ...snapshot.config, id: CONFIG_KEY });
    for (const s of snapshot.staff) await tx.objectStore('staff').put(s);
    for (const c of snapshot.customers) await tx.objectStore('customers').put(c);
    for (const t of snapshot.transactions) await tx.objectStore('transactions').put(t);
    for (const a of snapshot.audit) await tx.objectStore('audit').put(a);
    await tx.done;
  }
}
