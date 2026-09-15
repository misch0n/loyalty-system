/**
 * PostgreSQL connection pool + the two helpers every caller needs.
 *
 * Deliberately thin: no ORM, no query builder (BACKEND-PLAN §2, "small and
 * boring"). The commit transaction in Phase 2 is the one piece of logic that has
 * to be *obvious*, and it reads better as explicit `BEGIN` / `SELECT … FOR
 * UPDATE` / `COMMIT` than through an abstraction.
 */

import pg from 'pg';

const { Pool } = pg;

export type Db = pg.Pool;
/** A pool or a checked-out client — every query helper accepts either. */
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new Pool({
    connectionString,
    // A café till system has a handful of clients; a small pool keeps the
    // database's connection slots free for migrations and backups.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Liveness of the database itself, for `/readyz`. Returns a boolean rather than
 * throwing so the route can answer 503 instead of 500 — an unreachable database
 * is "not ready yet", not "this request failed".
 */
export async function checkDb(db: Queryable): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `fn` inside a single transaction on one checked-out client, rolling back
 * on any throw. The client is passed in so every statement inside `fn`
 * provably runs on the same connection — a `Pool.query` inside a transaction
 * would silently land on a different one.
 */
export async function withTransaction<T>(db: Db, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; the original error is the useful one.
    }
    throw err;
  } finally {
    client.release();
  }
}
