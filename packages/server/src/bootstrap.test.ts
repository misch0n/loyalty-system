import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap } from './bootstrap';
import type { Db } from './db';
import { verifySecret } from './hashing';
import { migrate } from './migrate';
import { databaseAvailable, resetSchema, testPool } from './testing/database';

const hasDatabase = await databaseAvailable();

const ADMIN = {
  username: 'manager',
  password: 'correct-horse',
  pin: '4321',
  name: 'Manager',
};

describe.skipIf(!hasDatabase)('bootstrap', () => {
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
    await db.query('TRUNCATE staff_accounts CASCADE');
  });

  it('creates the first admin from the environment', async () => {
    const outcome = await bootstrap(db, ADMIN);

    expect(outcome).toMatchObject({ status: 'created', username: 'manager' });

    const { rows } = await db.query('SELECT * FROM staff_accounts');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: 'manager', name: 'Manager', role: 'admin', active: true });
  });

  it('hashes the password and the PIN with argon2id — never stores the plaintext', async () => {
    await bootstrap(db, ADMIN);
    const { rows } = await db.query<{ password_hash: string; pin_hash: string }>(
      'SELECT password_hash, pin_hash FROM staff_accounts',
    );
    const stored = rows[0]!;

    expect(stored.password_hash).not.toBe(ADMIN.password);
    expect(stored.pin_hash).not.toBe(ADMIN.pin);
    expect(stored.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(stored.pin_hash.startsWith('$argon2id$')).toBe(true);

    expect(await verifySecret(stored.password_hash, ADMIN.password)).toBe(true);
    expect(await verifySecret(stored.password_hash, 'wrong')).toBe(false);
    expect(await verifySecret(stored.pin_hash, ADMIN.pin)).toBe(true);
  });

  it('is a no-op once an admin exists — it can never reset a live credential', async () => {
    await bootstrap(db, ADMIN);
    const before = await db.query('SELECT password_hash FROM staff_accounts');

    const outcome = await bootstrap(db, { ...ADMIN, password: 'a-different-password' });

    expect(outcome).toEqual({ status: 'already-bootstrapped' });
    const after = await db.query('SELECT password_hash FROM staff_accounts');
    expect(after.rows).toEqual(before.rows);
  });

  it('reports not-configured rather than seeding anything by default', async () => {
    // Explicitly NOT demoSeed: a production database gets no known credentials.
    const outcome = await bootstrap(db, null);

    expect(outcome).toEqual({ status: 'not-configured' });
    const { rows } = await db.query('SELECT id FROM staff_accounts');
    expect(rows).toEqual([]);
  });

  it('leaves an existing staff-only database without an admin alone', async () => {
    await db.query(
      `INSERT INTO staff_accounts (id, username, password_hash, role)
       VALUES ('s1', 'sam', 'argon2-hash', 'staff')`,
    );

    // No admin yet, so the bootstrap still applies.
    expect(await bootstrap(db, ADMIN)).toMatchObject({ status: 'created' });
    const { rows } = await db.query('SELECT id FROM staff_accounts ORDER BY id');
    expect(rows).toHaveLength(2);
  });
});
