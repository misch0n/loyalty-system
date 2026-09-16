import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { migrate } from './migrate.js';
import { listTables, resetSchema, testPool } from './testing/database.js';

const EXPECTED_TABLES = [
  'audit_log',
  'customers',
  'idempotency_keys',
  'loyalty_transactions',
  'program_config',
  'recovery_codes',
  'reward_events',
  'rewards',
  'schema_migrations',
  'sessions',
  'staff_accounts',
];

/** The ten schema tables, plus the runner's own `schema_migrations` registry. */
const SCHEMA_TABLE_COUNT = 10;

describe('migrations', () => {
  let db: Db;

  beforeAll(() => {
    db = testPool();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await resetSchema(db);
  });

  it('migrates a fresh database clean', async () => {
    const result = await migrate(db);

    expect(result.applied).toEqual(['001_initial.sql']);
    expect(result.skipped).toEqual([]);
    expect(await listTables(db)).toEqual(EXPECTED_TABLES);
    expect(EXPECTED_TABLES).toHaveLength(SCHEMA_TABLE_COUNT + 1);
  });

  it('is a no-op on a re-run', async () => {
    await migrate(db);
    const second = await migrate(db);

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['001_initial.sql']);
    expect(await listTables(db)).toEqual(EXPECTED_TABLES);
  });

  it('seeds exactly one program_config row, at the reward threshold of 9', async () => {
    await migrate(db);
    const { rows } = await db.query('SELECT * FROM program_config');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'singleton',
      points_per_reward: 9,
      max_points_per_transaction: 3,
      session_epoch: 0,
      self_deal_window_sec: 30,
      self_deal_count: 3,
      repeat_count: 3,
      repeat_window_min: 30,
    });

    await expect(
      db.query("INSERT INTO program_config (id, points_per_reward) VALUES ('other', 9)"),
    ).rejects.toThrow();
  });

  it('refuses an applied migration whose contents have changed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cafe-migrations-'));
    const file = path.join(dir, '001_test.sql');

    await writeFile(file, 'CREATE TABLE widgets (id text PRIMARY KEY);');
    await migrate(db, dir);

    await writeFile(file, 'CREATE TABLE widgets (id text PRIMARY KEY, extra text);');
    await expect(migrate(db, dir)).rejects.toThrow(/has changed since it was applied/);
  });

  it('leaves the database at the last complete migration when one fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cafe-migrations-'));
    await writeFile(path.join(dir, '001_ok.sql'), 'CREATE TABLE widgets (id text PRIMARY KEY);');
    await writeFile(path.join(dir, '002_broken.sql'), 'CREATE TABLE gadgets (id nonsense);');

    await expect(migrate(db, dir)).rejects.toThrow(/002_broken\.sql failed/);

    expect(await listTables(db)).toEqual(['schema_migrations', 'widgets']);
    const { rows } = await db.query('SELECT name FROM schema_migrations');
    expect(rows).toEqual([{ name: '001_ok.sql' }]);
  });
});

describe('schema integrity', () => {
  let db: Db;

  beforeAll(async () => {
    db = testPool();
    await resetSchema(db);
    await migrate(db);
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    // Order matters: children before parents.
    await db.query(
      'TRUNCATE reward_events, rewards, loyalty_transactions, recovery_codes, sessions, ' +
        'audit_log, idempotency_keys, customers, staff_accounts CASCADE',
    );
  });

  async function insertCustomer(id: string, overrides: Record<string, unknown> = {}) {
    const row = {
      token: `tok-${id}`,
      short_code: `SC${id.toUpperCase()}`,
      display_name: 'Ada',
      email: `${id}@example.com`,
      status: 'active',
      ...overrides,
    };
    return db.query(
      `INSERT INTO customers (id, token, short_code, display_name, email, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, row.token, row.short_code, row.display_name, row.email, row.status],
    );
  }

  async function insertStaff(id: string) {
    return db.query(
      `INSERT INTO staff_accounts (id, username, password_hash, role)
       VALUES ($1, $1, 'argon2-hash', 'staff')`,
      [id],
    );
  }

  describe('customers', () => {
    it('requires a name and an email on an active card', async () => {
      // SCOPE-DECISIONS §2.1 — token-only accounts are gone.
      await expect(insertCustomer('c1', { email: null })).rejects.toThrow(
        /customers_active_fields_present/,
      );
      await expect(insertCustomer('c2', { display_name: null })).rejects.toThrow(
        /customers_active_fields_present/,
      );
    });

    it('allows one card per email address, case-insensitively', async () => {
      await insertCustomer('c1', { email: 'Ada@Example.com' });

      await expect(insertCustomer('c2', { email: 'ada@example.com' })).rejects.toThrow(
        /customers_email_active_key/,
      );
    });

    it('frees the email address once the card is tombstoned', async () => {
      await insertCustomer('c1');
      await db.query(
        `UPDATE customers SET status = 'deleted', deleted_at = now(),
           token = NULL, short_code = NULL, display_name = NULL, email = NULL, phone = NULL
         WHERE id = 'c1'`,
      );

      // A new card on the freed address, starting at zero (SCOPE-DECISIONS §3.3, Q3).
      await expect(insertCustomer('c2', { email: 'c1@example.com' })).resolves.toBeTruthy();
    });

    it('refuses a tombstone that still carries anything identifying', async () => {
      await insertCustomer('c1');

      await expect(
        db.query(
          "UPDATE customers SET status = 'deleted', deleted_at = now(), token = NULL WHERE id = 'c1'",
        ),
      ).rejects.toThrow(/customers_deleted_fields_erased/);
    });

    it('keeps short codes unique among active cards', async () => {
      await insertCustomer('c1', { short_code: 'AAAA1111' });

      await expect(insertCustomer('c2', { short_code: 'AAAA1111' })).rejects.toThrow(
        /customers_short_code_active_key/,
      );
    });

    it('keeps tokens globally unique', async () => {
      await insertCustomer('c1', { token: 'shared-token' });

      await expect(insertCustomer('c2', { token: 'shared-token' })).rejects.toThrow(
        /customers_token_key/,
      );
    });
  });

  describe('staff accounts', () => {
    it('keeps usernames unique, case-insensitively', async () => {
      await insertStaff('s1');
      await expect(
        db.query(
          `INSERT INTO staff_accounts (id, username, password_hash, role)
           VALUES ('s2', 'S1', 'argon2-hash', 'admin')`,
        ),
      ).rejects.toThrow(/staff_accounts_username_key/);
    });

    it('does not constrain PINs to be unique', async () => {
      // SCOPE-DECISIONS §3.6: unimplementable against hashed PINs, and no longer
      // needed — a PIN is verified against an already-identified account.
      await insertStaff('s1');
      await db.query("UPDATE staff_accounts SET pin_hash = 'same-hash' WHERE id = 's1'");
      await insertStaff('s2');

      await expect(
        db.query("UPDATE staff_accounts SET pin_hash = 'same-hash' WHERE id = 's2'"),
      ).resolves.toBeTruthy();
    });
  });

  describe('append-only tables', () => {
    beforeEach(async () => {
      await insertStaff('s1');
      await insertCustomer('c1');
      await db.query(
        `INSERT INTO loyalty_transactions (id, customer_id, type, points, staff_id)
         VALUES ('t1', 'c1', 'accrual', 1, 's1')`,
      );
      await db.query(
        `INSERT INTO audit_log (id, actor_id, actor_role, action)
         VALUES ('a1', 's1', 'staff', 'loyalty.accrue')`,
      );
      await db.query(
        `INSERT INTO rewards (id, token, short_code, owner_id, status, issued_at,
                              source_txn_id, description_snapshot)
         VALUES ('r1', 'rtok', 'RSC1', 'c1', 'unspent', now(), 't1', 'Free regular coffee')`,
      );
      await db.query(
        `INSERT INTO reward_events (id, reward_id, type, customer_id)
         VALUES ('e1', 'r1', 'reward.issued', 'c1')`,
      );
    });

    it.each([
      ['loyalty_transactions', 't1'],
      ['audit_log', 'a1'],
      ['reward_events', 'e1'],
    ])('rejects UPDATE and DELETE on %s', async (table, id) => {
      // CLAUDE.md: corrections are `reversal` entries, never destructive edits.
      await expect(db.query(`UPDATE ${table} SET id = 'x' WHERE id = $1`, [id])).rejects.toThrow(
        /append-only/,
      );
      await expect(db.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(
        /append-only/,
      );
    });

    it('still allows rewards (a projection, not a log) to change status', async () => {
      await expect(
        db.query(
          "UPDATE rewards SET status = 'spent', spent_at = now(), spent_by_staff_id = 's1' WHERE id = 'r1'",
        ),
      ).resolves.toBeTruthy();
    });
  });

  describe('ledger and audit vocabularies', () => {
    beforeEach(async () => {
      await insertStaff('s1');
      await insertCustomer('c1');
    });

    it("rejects the retired 'redemption' ledger type", async () => {
      // Replaced by 'reward_issue' in the rewards-as-objects rework.
      await expect(
        db.query(
          `INSERT INTO loyalty_transactions (id, customer_id, type, points, staff_id)
           VALUES ('t1', 'c1', 'redemption', -9, 's1')`,
        ),
      ).rejects.toThrow(/loyalty_transactions_type_check/);
    });

    it('accepts the three live ledger types', async () => {
      await expect(
        db.query(
          `INSERT INTO loyalty_transactions (id, customer_id, type, points, staff_id) VALUES
             ('t1', 'c1', 'accrual', 1, 's1'),
             ('t2', 'c1', 'reward_issue', -9, 's1'),
             ('t3', 'c1', 'reversal', -1, 's1')`,
        ),
      ).resolves.toBeTruthy();
    });

    it("rejects an 'audit.export' row — the export surface does not exist", async () => {
      // SCOPE-DECISIONS §1 / BACKEND-PLAN §4-F: resolved by deletion. Nothing may
      // write this action, so the database refuses it outright.
      await expect(
        db.query(
          `INSERT INTO audit_log (id, actor_id, actor_role, action)
           VALUES ('a1', 's1', 'admin', 'audit.export')`,
        ),
      ).rejects.toThrow(/audit_log_action_check/);
    });

    it('keeps staff attribution after the account is deleted', async () => {
      // No FK on staff_id: deleting an account must not erase or block history.
      await db.query(
        `INSERT INTO loyalty_transactions (id, customer_id, type, points, staff_id)
         VALUES ('t1', 'c1', 'accrual', 1, 's1')`,
      );
      await db.query("DELETE FROM staff_accounts WHERE id = 's1'");

      const { rows } = await db.query("SELECT staff_id FROM loyalty_transactions WHERE id = 't1'");
      expect(rows[0]).toEqual({ staff_id: 's1' });
    });
  });

  describe('sessions', () => {
    it('requires exactly one subject', async () => {
      await insertStaff('s1');

      await expect(
        db.query(
          `INSERT INTO sessions (id, token_hash, kind, expires_at)
           VALUES ('sess1', 'hash', 'staff', now() + interval '1 day')`,
        ),
      ).rejects.toThrow(/sessions_subject/);

      await expect(
        db.query(
          `INSERT INTO sessions (id, token_hash, kind, staff_id, expires_at)
           VALUES ('sess1', 'hash', 'staff', 's1', now() + interval '1 day')`,
        ),
      ).resolves.toBeTruthy();
    });

    it('drops a staff account\'s sessions when the account goes', async () => {
      await insertStaff('s1');
      await db.query(
        `INSERT INTO sessions (id, token_hash, kind, staff_id, expires_at)
         VALUES ('sess1', 'hash', 'staff', 's1', now() + interval '1 day')`,
      );

      await db.query("DELETE FROM staff_accounts WHERE id = 's1'");

      const { rows } = await db.query('SELECT id FROM sessions');
      expect(rows).toEqual([]);
    });
  });
});
