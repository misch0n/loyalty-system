/**
 * Recovery codes — issue, consume, and the lockout that makes a short code safe.
 *
 * SCOPE-DECISIONS §2.3 replaced the emailed magic link with a code the customer
 * **types on the device in their hand**. A link opens on whichever device reads
 * the mail, which is frequently the wrong one; a typed code binds the card to
 * the device that typed it. The cost is that the secret has to be short enough
 * to key in, and §2.3 is explicit about the consequence: *"rate limiting and
 * attempt lockout do the work length no longer does — a 6-character code with
 * unlimited attempts is not a secret."*
 *
 * So three things carry the security here, none of them length:
 *
 *   1. **The code is scoped to one address.** A guess is checked against the
 *      codes issued to *that customer*, never against every live code in the
 *      table. Without this, a guesser plays against the whole outstanding set at
 *      once, and the odds improve with every customer who asks for a code.
 *   2. **`attempts` is durable.** Five wrong guesses burn the code in the
 *      database, so a lockout survives a restart — unlike the in-memory
 *      `AttemptLimiter`, which the routes also use as the cheap first line.
 *   3. **Issuing supersedes.** A second request kills the first code, so a
 *      caller cannot stack live codes to widen the target.
 *
 * ## This IS the port's shape now
 *
 * The port used to carry a different pair: `consumeRecoveryCode(code)`, a lookup
 * by value across the whole table. That was right for the prototype's 128-bit
 * token, which carries its own security and needs no address, and wrong for six
 * typed characters — the recovery-flow twin of §4-B's global PIN lookup. Phase 5
 * inverted the lookup here and left the port's version implemented-but-unused,
 * with a guardrail test forbidding callers; Phase 6 put this shape *on* the port
 * (`TrustedStore.createRecoveryCode` / `consumeRecoveryCode` /
 * `recordFailedRecoveryAttempt`), so `PostgresStore` simply delegates to these
 * three and there is one implementation rather than two. Recorded as a
 * divergence from prototype behaviour in `STATUS.md`.
 *
 * The code itself is never stored: only its SHA-256. That is the right hash for
 * this value even though it is short, because {@link hashRecoveryCode} is not
 * what stands between a guesser and the code — the three controls above are. A
 * stretched hash would only slow down someone who has already read the database,
 * who can equally read the customer's email address and walk in.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { withTransaction } from '../db.js';

/**
 * Crockford base32, the same alphabet as the card short code — no I, L, O or U,
 * so nothing is ambiguous when it is read off a phone screen and typed into
 * another one. `normalizeShortCode` folds the mistakes people still make (I/L→1,
 * O→0) and strips separators, so "k39-xq4" is accepted for "K39XQ4".
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Six characters ≈ 30 bits. Short by design; see the header for what protects it. */
export const RECOVERY_CODE_LENGTH = 6;

/** How long a code stays valid. Matches the prototype's `RecoveryService`. */
export const RECOVERY_EXPIRY_MINUTES = 15;

/**
 * Wrong guesses a code survives. Five is the PIN limiter's number, for the same
 * reason: a person who has the mail open in front of them does not miss five
 * times, and at 30 bits five guesses is not a dent in the keyspace.
 */
export const RECOVERY_MAX_ATTEMPTS = 5;

/** A fresh code. `256 % 32 === 0`, so the modulo introduces no bias. */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CROCKFORD[b % 32];
  return out;
}

/** SHA-256 hex — a recovery code is never stored in the clear. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** True for a well-formed code, after normalization. */
export function isValidRecoveryCode(code: string): boolean {
  return new RegExp(`^[${CROCKFORD}]{${RECOVERY_CODE_LENGTH}}$`).test(code);
}

/**
 * Issues a code for a customer, superseding any still live, and returns the
 * plaintext — the **only** moment it exists outside the mail.
 *
 * Both statements run in one transaction so there is never an instant with two
 * live codes, and never one with none.
 */
export async function issueRecoveryCode(
  db: Db,
  customerId: string,
  now: () => number = Date.now,
): Promise<string> {
  const code = generateRecoveryCode();
  const expiresAt = new Date(now() + RECOVERY_EXPIRY_MINUTES * 60_000);

  await withTransaction(db, async (tx) => {
    // Superseding matters: without it, asking twice leaves two codes a guesser
    // may play against, and asking a hundred times leaves a hundred.
    await tx.query(
      `UPDATE recovery_codes SET used_at = now()
        WHERE customer_id = $1 AND used_at IS NULL`,
      [customerId],
    );
    await tx.query(
      `INSERT INTO recovery_codes (id, code_hash, customer_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), hashRecoveryCode(code), customerId, expiresAt],
    );
  });

  return code;
}

/**
 * Validates and consumes a code **for one customer**, in a single statement.
 *
 * The predicate and the write happen under the same row lock, so two
 * simultaneous consumes of one code cannot both succeed: single-use is enforced
 * by the database, not checked and hoped for. `attempts < $3` is part of the
 * predicate rather than a separate read, so a code that reached the limit
 * between the check and the guess is still refused.
 */
export async function consumeRecoveryCode(
  db: Db,
  customerId: string,
  code: string,
): Promise<boolean> {
  if (!isValidRecoveryCode(code)) return false;
  const { rowCount } = await db.query(
    `UPDATE recovery_codes SET used_at = now()
      WHERE customer_id = $1 AND code_hash = $2 AND used_at IS NULL
        AND expires_at > now() AND attempts < $3`,
    [customerId, hashRecoveryCode(code), RECOVERY_MAX_ATTEMPTS],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Counts a wrong guess against every code live for this customer, burning any
 * that reach the limit.
 *
 * Burning in the same statement is what makes the lockout durable — an
 * in-memory counter forgets on restart, and "restart the container" must not be
 * a way to buy five more guesses.
 */
export async function recordFailedAttempt(db: Db, customerId: string): Promise<void> {
  await db.query(
    `UPDATE recovery_codes
        SET attempts = attempts + 1,
            used_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE used_at END
      WHERE customer_id = $1 AND used_at IS NULL AND expires_at > now()`,
    [customerId, RECOVERY_MAX_ATTEMPTS],
  );
}
