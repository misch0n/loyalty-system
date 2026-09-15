/**
 * Global test setup — the database gate.
 *
 * The server suite **refuses to run** without a real Postgres. It does not skip.
 *
 * Skipping was the old behaviour and it was dangerous: a run with no database
 * reported `22 passed | 84 skipped` and exited 0, so a green tick could mean the
 * schema, the store and the whole conformance suite had never executed. That is
 * a false negative with the shape of a pass, and server CI does not exist until
 * Phase 9 to catch it.
 *
 * Failing here instead of in each suite means the guarantee lives in the config,
 * not in a `skipIf` every future test author has to remember to write correctly.
 * A new database-backed test cannot silently opt out of it.
 */

import { createPool } from '../db';
import { TEST_DATABASE_URL } from './database';

/** Redact the password before the URL goes anywhere a human can read it. */
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(unparseable TEST_DATABASE_URL)';
  }
}

export async function setup(): Promise<void> {
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await pool.query('SELECT 1');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      [
        '',
        'The server test suite needs a real PostgreSQL database and could not reach one.',
        '',
        `  tried:  ${safeUrl(TEST_DATABASE_URL)}`,
        `  error:  ${reason}`,
        '',
        'These tests are not skipped on purpose: the schema constraints, the row lock and',
        'the DataStore conformance suite only mean something when they run against Postgres.',
        '',
        'Start one, then re-run:',
        '',
        '  export PGDATA=/var/lib/postgresql/testdata',
        '  mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"',
        '  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -A trust"',
        '  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l /tmp/pg.log -w start"',
        '  su postgres -c "psql -h localhost -c \\"CREATE ROLE cafe LOGIN PASSWORD \'cafe\' SUPERUSER;\\""',
        '  su postgres -c "psql -h localhost -c \'CREATE DATABASE cafe_loyalty_test OWNER cafe;\'"',
        '',
        'Or point TEST_DATABASE_URL at an existing database.',
        'Full notes: docs/BACKEND-PLAN.md §0, "Running the server tests".',
        '',
      ].join('\n'),
    );
  } finally {
    await pool.end();
  }
}
