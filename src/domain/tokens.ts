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
