/**
 * Random token generation.
 *
 * Identity = a 128-bit random opaque token. It is NEVER derived from name/phone
 * (low-entropy, forgeable). A leaked/screenshotted card therefore exposes no PII.
 *
 * Uses the platform CSPRNG (`crypto.getRandomValues`), available in browsers and
 * in Node ≥ 19 as a global. This is randomness, not I/O — the function stays
 * pure-enough to unit-test.
 */

const TOKEN_BYTES = 16; // 128 bits

/** Encode bytes as URL-safe base64 without padding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a fresh 128-bit opaque customer token (22-char base64url). */
export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Generate an internal id (also random; not customer-facing). */
export function generateId(): string {
  // randomUUID is widely available in modern browsers and Node.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** A token is well-formed if it is a 22-char URL-safe base64 string. */
export function isValidToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(token);
}

// ── short code (human-shareable recovery handle) ─────────────────────────────
//
// The token stays the cryptographic identity (QR / wallet / recovery link). The
// short code is a SEPARATE, human-friendly handle a customer can read aloud if
// the camera fails. Crockford base32 (no I/L/O/U) avoids ambiguous characters;
// 8 chars ≈ 40 bits, unique per active card (the store checks on create).

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 symbols, no I L O U
const SHORT_CODE_LEN = 8;

/** Generate a fresh Crockford-base32 short code (8 chars). 256 % 32 == 0 → no bias. */
export function generateShortCode(): string {
  const bytes = new Uint8Array(SHORT_CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CROCKFORD[b % 32];
  return out;
}

/**
 * Normalize typed input to the canonical short code: upper-case, fold Crockford's
 * ambiguous characters (I/L→1, O→0), and strip anything outside the alphabet
 * (spaces, hyphens, etc.).
 */
export function normalizeShortCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, ''); // keep only the Crockford alphabet
}

/** True if a normalized code is a well-formed short code. */
export function isValidShortCode(code: string): boolean {
  return new RegExp(`^[${CROCKFORD}]{${SHORT_CODE_LEN}}$`).test(code);
}

/** Display form: grouped 4-4 for readability, e.g. "K39X-Q4T7". Safe on missing. */
export function formatShortCode(code: string | undefined | null): string {
  if (!code) return '';
  return code.length === SHORT_CODE_LEN ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// ── reward identifiers (rewards-as-objects, REWARDS-PLAN §3.6) ────────────────
//
// A Reward carries the SAME two-handle scheme as a customer card: a 128-bit
// opaque token (carried in the reward QR) and a Crockford-base32 short code for
// the MANUAL / camera-fail path only. They reuse the customer machinery verbatim
// — named here so the rewards model has clear, intent-revealing factories and so
// the alphabet/length stay in lockstep (`normalizeShortCode`/`isValidShortCode`
// validate a reward short code unchanged).

/** Generate a fresh 128-bit opaque reward token (carried in the reward QR). */
export function generateRewardToken(): string {
  return generateToken();
}

/** Generate a fresh reward short code (Crockford base32, MANUAL path only). */
export function generateRewardShortCode(): string {
  return generateShortCode();
}
