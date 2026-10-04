import { describe, it, expect } from 'vitest';
import {
  validateRegistration,
  findDuplicates,
  normalizePhone,
} from '../src/domain/validation.js';
import type { Customer } from '../src/domain/models.js';

function customer(over: Partial<Customer>): Customer {
  return {
    id: over.id ?? 'c1',
    token: 'tok0000000000000000000',
    shortCode: 'ABCD1234',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('validateRegistration', () => {
  const valid = { displayName: 'Maria', email: 'maria@cafe.test', consent: true };

  it('accepts a name, an email and consent', () => {
    expect(validateRegistration(valid)).toEqual([]);
  });

  it('requires consent', () => {
    const errors = validateRegistration({ ...valid, consent: false });
    expect(errors.map((e) => e.field)).toEqual(['consent']);
  });

  it('requires a name — blank counts as missing', () => {
    expect(validateRegistration({ ...valid, displayName: undefined }).map((e) => e.field)).toEqual([
      'displayName',
    ]);
    expect(validateRegistration({ ...valid, displayName: '   ' }).map((e) => e.field)).toEqual([
      'displayName',
    ]);
  });

  it('rejects a name over 80 characters', () => {
    expect(validateRegistration({ ...valid, displayName: 'x'.repeat(80) })).toEqual([]);
    const errors = validateRegistration({ ...valid, displayName: 'x'.repeat(81) });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('too long');
  });

  it('requires an email — blank counts as missing', () => {
    expect(validateRegistration({ ...valid, email: undefined }).map((e) => e.field)).toEqual([
      'email',
    ]);
    expect(validateRegistration({ ...valid, email: '   ' }).map((e) => e.field)).toEqual([
      'email',
    ]);
  });

  it('rejects a malformed email', () => {
    expect(validateRegistration({ ...valid, email: 'nope' }).map((e) => e.field)).toEqual([
      'email',
    ]);
    expect(validateRegistration({ ...valid, email: ' a@b.co ' })).toEqual([]);
  });

  it('no longer accepts a token-only registration', () => {
    const fields = validateRegistration({ consent: true }).map((e) => e.field);
    expect(fields).toEqual(['displayName', 'email']);
  });

  it('keeps phone optional but rejects a malformed one', () => {
    expect(validateRegistration({ ...valid, phone: 'abc' })).toHaveLength(1);
    expect(validateRegistration({ ...valid, phone: '+1 (555) 123-4567' })).toEqual([]);
    expect(validateRegistration({ ...valid, phone: '  ' })).toEqual([]);
  });
});

describe('findDuplicates', () => {
  const existing = [
    customer({ id: 'a', displayName: 'Maria', email: 'maria@cafe.test', phone: '+1 555 0000' }),
    customer({ id: 'b', displayName: 'Jon', status: 'deleted', email: 'jon@cafe.test' }),
  ];

  it('matches on email case-insensitively', () => {
    const dup = findDuplicates({ email: 'MARIA@cafe.test' }, existing);
    expect(dup.map((c) => c.id)).toEqual(['a']);
  });

  it('matches on phone ignoring formatting', () => {
    const dup = findDuplicates({ phone: '15550000' }, existing);
    expect(dup.map((c) => c.id)).toEqual(['a']);
  });

  it('matches on exact name', () => {
    expect(findDuplicates({ displayName: 'maria' }, existing).map((c) => c.id)).toEqual(['a']);
  });

  it('ignores deleted customers', () => {
    expect(findDuplicates({ email: 'jon@cafe.test' }, existing)).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(findDuplicates({}, existing)).toEqual([]);
  });
});

describe('normalizePhone', () => {
  it('keeps digits only', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567');
  });
});
