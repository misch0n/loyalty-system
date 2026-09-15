/**
 * Credential hashing — argon2id, server-side, from the plaintext.
 *
 * BACKEND-PLAN §4-A and SCOPE-DECISIONS §3.5 both land here from opposite
 * directions: the client must not hash. Whatever the client sends *is* the
 * credential, so a client-computed "hash" is a password that happens to look
 * like a hash — replayable by anyone who reads the database. TLS protects it in
 * transit; argon2id protects it at rest.
 *
 * Passwords and PINs use the same function. A 4-digit PIN has no meaningful
 * entropy whatever the KDF, so its protection is rate limiting and lockout
 * (Phase 3) — hashing it only stops a database reader from walking up to a till.
 */

import argon2 from 'argon2';

/**
 * OWASP's second recommended argon2id configuration (19 MiB, t=2, p=1). Chosen
 * over the heavier profile because the till is a phone-facing API on a flat-rate
 * VPS and a sign-in must not take a visible pause.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashSecret(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, OPTIONS);
}

/**
 * Verifies a plaintext against a stored hash. Never throws on a bad hash — a
 * malformed or legacy value is simply "does not verify", so a corrupt row can't
 * turn a failed sign-in into a 500 that leaks which account it was.
 */
export async function verifySecret(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
