/**
 * A `fetch` that keeps cookies, for driving the API from Node.
 *
 * The SPA's session is an HttpOnly cookie and its CSRF token a readable one; a
 * browser keeps both without being asked. Node's `fetch` keeps nothing, so the
 * live test harness and the dev seed — the two Node-side callers of the real
 * `createServices` — give it a jar. Attributes (`Secure`, `Path`, expiry other
 * than `Max-Age=0`) are ignored: this is one device talking to one origin.
 */

export interface CookieJarFetch {
  fetch: typeof fetch;
  /** Cookie name → value, as a browser would hold them for this device. */
  jar: Map<string, string>;
}

export function cookieJarFetch(extraHeaders: Record<string, string> = {}): CookieJarFetch {
  const jar = new Map<string, string>();
  const jarFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (jar.size > 0) {
      headers.set(
        'cookie',
        [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; '),
      );
    }
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    const response = await fetch(input, { ...init, headers });
    for (const entry of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = entry.split(';');
      const equals = pair.indexOf('=');
      if (equals < 1) continue;
      const name = pair.slice(0, equals).trim();
      const value = decodeURIComponent(pair.slice(equals + 1).trim());
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
  return { fetch: jarFetch, jar };
}
