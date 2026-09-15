/**
 * Production bootstrap — the first admin account.
 *
 * Explicitly **not** `demoSeed`: no demo members, no ledger history, no seeded
 * staff with known passwords. A production database starts with one admin (from
 * the environment) and the default program config (inserted by migration 001),
 * and nothing else.
 *
 * Idempotent. Once any admin exists this does nothing — so it is safe to run on
 * every container start, and it can never reset a real account's credential
 * back to whatever is in the environment.
 */

import { generateId } from '@cafe/shared/domain/tokens';
import type { Db } from './db';
import { createPool } from './db';
import type { BootstrapAdmin } from './env';
import { loadEnv } from './env';
import { hashSecret } from './hashing';

export type BootstrapOutcome =
  /** An admin already existed; nothing was written. */
  | { status: 'already-bootstrapped' }
  /** No admin exists and no bootstrap credentials were configured. */
  | { status: 'not-configured' }
  | { status: 'created'; staffId: string; username: string };

export async function bootstrap(db: Db, admin: BootstrapAdmin | null): Promise<BootstrapOutcome> {
  const { rows } = await db.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM staff_accounts WHERE role = 'admin') AS exists",
  );
  if (rows[0]?.exists) return { status: 'already-bootstrapped' };
  if (!admin) return { status: 'not-configured' };

  const [passwordHash, pinHash] = await Promise.all([
    hashSecret(admin.password),
    hashSecret(admin.pin),
  ]);

  const staffId = generateId();
  // ON CONFLICT covers two containers racing this on a cold start: the loser
  // finds the username taken and writes nothing.
  const inserted = await db.query(
    `INSERT INTO staff_accounts (id, username, name, password_hash, pin_hash, role, active)
     VALUES ($1, $2, $3, $4, $5, 'admin', true)
     ON CONFLICT DO NOTHING`,
    [staffId, admin.username, admin.name ?? null, passwordHash, pinHash],
  );
  if (inserted.rowCount === 0) return { status: 'already-bootstrapped' };

  return { status: 'created', staffId, username: admin.username };
}

/** CLI entrypoint: `npm run bootstrap -w @cafe/server`. */
async function main(): Promise<void> {
  const env = loadEnv();
  const db = createPool(env.databaseUrl);
  try {
    const outcome = await bootstrap(db, env.bootstrapAdmin);
    switch (outcome.status) {
      case 'created':
        // The username is an operational fact, not PII, and an operator needs to
        // know which account to sign in as. The credential is never logged.
        console.log(`Created the first admin account: ${outcome.username}`);
        break;
      case 'already-bootstrapped':
        console.log('An admin account already exists — nothing to do.');
        break;
      case 'not-configured':
        console.warn(
          'No admin account exists and no bootstrap credentials are set. ' +
            'Set BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD and ' +
            'BOOTSTRAP_ADMIN_PIN, then run this again.',
        );
        break;
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
