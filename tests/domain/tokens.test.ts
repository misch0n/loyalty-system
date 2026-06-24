import { describe, it, expect } from 'vitest';
import {
  generateToken,
  generateId,
  isValidToken,
  generateShortCode,
  normalizeShortCode,
  isValidShortCode,
  formatShortCode,
} from '../../src/domain/tokens';

describe('generateToken', () => {
  it('produces a 22-char url-safe base64 token (128 bits)', () => {
    const token = generateToken();
    expect(isValidToken(token)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('is effectively unique across many draws', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(set.size).toBe(1000);
  });

  it('never contains URL-unsafe characters', () => {
    for (let i = 0; i < 50; i++) {
      const token = generateToken();
      expect(token).not.toMatch(/[+/=]/);
    }
  });
});

describe('generateId', () => {
  it('returns a non-empty unique string', () => {
    expect(generateId()).not.toBe(generateId());
  });
});

describe('isValidToken', () => {
  it('rejects malformed tokens', () => {
    expect(isValidToken('')).toBe(false);
    expect(isValidToken('too-short')).toBe(false);
    expect(isValidToken('has spaces here aaaaaa')).toBe(false);
  });
});

describe('short code', () => {
  it('generates an 8-char Crockford code (no ambiguous I/L/O/U)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShortCode();
      expect(isValidShortCode(code)).toBe(true);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('normalizes typed input: upper-case, fold I/L→1 and O→0, strip separators', () => {
    expect(normalizeShortCode('k39x-q4t7')).toBe('K39XQ4T7');
    expect(normalizeShortCode('o0 il 1')).toBe('00111'); // O→0, I/L→1
    expect(normalizeShortCode('  ab cd ef gh  ')).toBe('ABCDEFGH');
  });

  it('formats for display as two groups of four', () => {
    expect(formatShortCode('K39XQ4T7')).toBe('K39X-Q4T7');
    expect(formatShortCode('short')).toBe('short'); // wrong length → unchanged
  });

  it('isValidShortCode rejects wrong length or out-of-alphabet', () => {
    expect(isValidShortCode('K39XQ4T')).toBe(false); // 7 chars
    expect(isValidShortCode('K39XQ4TI')).toBe(false); // contains I
  });
});
