/**
 * Migration runner.
 *
 * Numbered, forward-only `.sql` files applied in filename order and recorded in
 * `schema_migrations`. Idempotent: re-running applies nothing. Run as a one-shot
 * `migrate` container before `api` starts (Phase 8).
 *
 * There are no down-migrations — a restore comes from a backup, not from
 * unwinding DDL. A correction is a new numbered file.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import { createPool } from './db.js';
import { loadEnv } from './env.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Advisory-lock key. Two `migrate` containers starting together must not both
 * apply 001; the loser waits and then finds nothing to do.
 */
const LOCK_KEY = 8_531_207;

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  /** Files applied by THIS run — empty on a re-run. */
  applied: string[];
  /** Files already recorded before this run. */
  skipped: string[];
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Reads the migration files in filename order (`001_…` before `002_…`). */
export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = await readdir(dir);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  const migrations: Migration[] = [];
  for (const name of files) {
    const sql = await readFile(path.join(dir, name), 'utf8');
    migrations.push({ name, sql, checksum: checksum(sql) });
  }
  return migrations;
}

async function ensureRegistry(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text        PRIMARY KEY,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Applies every pending migration. Each file runs inside its own transaction, so
 * a failure leaves the database at the last complete migration rather than
 * half-way through one.
 */
export async function migrate(db: Db, dir: string = MIGRATIONS_DIR): Promise<MigrateResult> {
  const migrations = await loadMigrations(dir);
  await ensureRegistry(db);

  const client = await db.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const recorded = new Map(rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const previous = recorded.get(migration.name);
      if (previous !== undefined) {
        // An applied file that has since changed means the schema on disk and
        // the schema in the database have diverged. Refusing is the only safe
        // answer: silently skipping hides the drift, re-running corrupts.
        if (previous !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} has changed since it was applied. ` +
              'Migrations are immutable — add a new numbered file instead.',
          );
        }
        skipped.push(migration.name);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
      applied.push(migration.name);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }

  return { applied, skipped };
}

/** CLI entrypoint: `npm run migrate -w @cafe/server`. */
async function main(): Promise<void> {
  const env = loadEnv();
  const db = createPool(env.databaseUrl);
  try {
    const result = await migrate(db);
    if (result.applied.length === 0) {
      console.log(`Database up to date (${result.skipped.length} migrations already applied).`);
    } else {
      console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
    }
  } finally {
    await db.end();
  }
}

// Only run when executed directly, never when imported by a test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
