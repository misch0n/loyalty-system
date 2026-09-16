/**
 * Test-database helper.
 *
 * The migration and store suites run against a **real** Postgres, never a fake.
 * The whole point of `PostgresStore` is the integrity IndexedDB cannot give us —
 * constraints, row locks, append-only triggers — and none of that is exercised
 * by a stub.
 *
 * There is no availability probe here any more. Reachability is asserted once,
 * for the whole run, in `globalSetup.ts`: no database means the suite fails, not
 * that it quietly skips.
 */

import type { Db } from '../db.js';
import { createPool } from '../db.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cafe:cafe@localhost:5432/cafe_loyalty_test';

export function testPool(): Db {
  return createPool(TEST_DATABASE_URL);
}

/**
 * Drops and recreates the `public` schema, so a suite starts from genuinely
 * nothing — the "fresh db container" state the migration has to survive.
 */
export async function resetSchema(db: Db): Promise<void> {
  await db.query('DROP SCHEMA IF EXISTS public CASCADE');
  await db.query('CREATE SCHEMA public');
}

/** Table names present in the current schema. */
export async function listTables(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}
