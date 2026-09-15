import { describe, expect, it } from 'vitest';
import { clearCookie, parseCookies, serializeCookie } from './cookies';

describe('parseCookies', () => {
  it('reads every pair in a header', () => {
    expect(parseCookies('cafe_session=abc; cafe_csrf=def')).toEqual({
      cafe_session: 'abc',
      cafe_csrf: 'def',
    });
  });

  it('is empty for a request with no cookies', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('decodes percent-encoded values and strips quotes', () => {
    expect(parseCookies('a=%2Fslash%2F; b="quoted"')).toEqual({ a: '/slash/', b: 'quoted' });
  });

  it('keeps the first of a repeated name', () => {
    // A stale cookie on a broader path can shadow the current one; taking the
    // first match is what browsers send first (most specific path).
    expect(parseCookies('s=first; s=second')).toEqual({ s: 'first' });
  });

  it('skips malformed pairs rather than failing the request', () => {
    expect(parseCookies('novalue; =empty; good=1')).toEqual({ good: '1' });
  });

  it('takes an undecodable value literally', () => {
    expect(parseCookies('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' });
  });
});

describe('serializeCookie', () => {
  it('defaults to a site-wide Lax cookie', () => {
    expect(serializeCookie('s', 'v')).toBe('s=v; Path=/; SameSite=Lax');
  });

  it('carries every attribute the session cookie needs', () => {
    const header = serializeCookie('cafe_session', 'tok', {
      httpOnly: true,
      secure: true,
      maxAgeSec: 3600,
    });
    expect(header).toBe('cafe_session=tok; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax');
  });

  it('percent-encodes a value that would break the header', () => {
    expect(serializeCookie('s', 'a;b=c')).toContain('s=a%3Bb%3Dc');
  });

  it('refuses a name that is not a cookie token', () => {
    expect(() => serializeCookie('bad name', 'v')).toThrow(/Invalid cookie name/);
  });

  it('never emits a negative Max-Age', () => {
    expect(serializeCookie('s', 'v', { maxAgeSec: -5 })).toContain('Max-Age=0');
  });
});

describe('clearCookie', () => {
  it('expires the cookie while keeping the attributes it was set with', () => {
    // A mismatched Path leaves the original cookie in place — this is the bug
    // that makes a "sign out" look like it worked and leave the session alive.
    const header = clearCookie('cafe_session', { httpOnly: true, secure: true });
    expect(header).toBe('cafe_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  });
});
