import { describe, it, expect } from 'vitest';
import {
  validateRegistration,
  isTokenOnly,
  findDuplicates,
  isRecoverable,
  normalizePhone,
} from '../../src/domain/validation';
import type { Customer } from '../../src/domain/models';

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
  it('requires consent', () => {
    const errors = validateRegistration({ consent: false });
    expect(errors.some((e) => e.field === 'consent')).toBe(true);
  });

  it('allows a token-only account (no PII) with consent', () => {
    expect(validateRegistration({ consent: true })).toEqual([]);
  });

  it('rejects a malformed email but accepts a blank one', () => {
    expect(validateRegistration({ consent: true, email: 'nope' })).toHaveLength(1);
    expect(validateRegistration({ consent: true, email: '   ' })).toEqual([]);
    expect(validateRegistration({ consent: true, email: 'a@b.co' })).toEqual([]);
  });

  it('rejects a malformed phone but accepts a blank one', () => {
    expect(validateRegistration({ consent: true, phone: 'abc' })).toHaveLength(1);
    expect(validateRegistration({ consent: true, phone: '+1 (555) 123-4567' })).toEqual([]);
  });
});

describe('isTokenOnly', () => {
  it('is true when no PII is provided', () => {
    expect(isTokenOnly({ consent: true })).toBe(true);
    expect(isTokenOnly({ consent: true, displayName: '  ' })).toBe(true);
  });
  it('is false when any field is provided', () => {
    expect(isTokenOnly({ consent: true, email: 'a@b.co' })).toBe(false);
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

describe('isRecoverable', () => {
  it('is false for token-only customers', () => {
    expect(isRecoverable(customer({}))).toBe(false);
  });
  it('is true when any contact detail exists', () => {
    expect(isRecoverable(customer({ phone: '555' }))).toBe(true);
  });
});

describe('normalizePhone', () => {
  it('keeps digits only', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567');
  });
});
