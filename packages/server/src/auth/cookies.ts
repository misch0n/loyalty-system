/**
 * Cookie parsing and serialization.
 *
 * Hand-written rather than pulled in as a dependency, for the same reason the
 * rest of the server is: the whole surface we need is one header in and one
 * header out, with attributes we choose ourselves. `CLAUDE.md` — "don't add
 * dependencies the spec didn't call for"; BACKEND-PLAN §0 lists the server's
 * three (`fastify`, `pg`, `argon2`).
 *
 * Nothing here is cryptographic: signing is unnecessary because a session cookie
 * carries a 256-bit random token that is looked up server-side, not a value the
 * server trusts on sight.
 */

export interface CookieOptions {
  /** Hidden from JavaScript. On for the session cookie, off for the CSRF one. */
  httpOnly?: boolean;
  /** HTTPS only. Always on in production; see `COOKIE_SECURE`. */
  secure?: boolean;
  /**
   * `Lax` is the default and what BACKEND-PLAN §2 specifies: it keeps the cookie
   * off cross-site POSTs (the CSRF vector) while surviving a normal top-level
   * navigation to the card — which is exactly how a customer opens theirs.
   */
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  maxAgeSec?: number;
}

/** RFC 6265 cookie-name token characters. */
const NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/**
 * Parses a `Cookie` request header. Tolerant by design — a malformed pair is
 * skipped rather than failing the request, because a browser may be carrying
 * cookies this server never set. The first occurrence of a name wins.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const pair of header.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 1) continue;
    const name = pair.slice(0, equals).trim();
    if (!name || name in cookies) continue;

    let value = pair.slice(equals + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // A value that isn't valid percent-encoding is taken literally rather than
      // discarded — it still might be a token we issued before an encoding change.
      cookies[name] = value;
    }
  }
  return cookies;
}

/** Builds one `Set-Cookie` header value. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!NAME_PATTERN.test(name)) throw new Error('Invalid cookie name.');

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`];
  if (options.maxAgeSec !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSec))}`);
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

/**
 * Builds the `Set-Cookie` that deletes a cookie. The attributes must match the
 * ones it was set with (path especially) or the browser keeps the original.
 */
export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...options, maxAgeSec: 0 });
}
