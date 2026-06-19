import { describe, it, expect } from 'vitest';
import { generateToken, generateId, isValidToken } from '../../src/domain/tokens';

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
