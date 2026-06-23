/**
 * Input validation + duplicate detection — pure functions.
 *
 * All registration PII is optional (a fully token-only account is valid), so
 * these checks only reject values that are present AND malformed.
 */

import type { Customer } from './models';

export interface RegistrationInput {
  displayName?: string;
  email?: string;
  phone?: string;
  consent: boolean;
}

export interface FieldError {
  field: 'displayName' | 'email' | 'phone' | 'consent';
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Permissive phone check: digits, spaces and + ( ) - , 6–20 chars.
const PHONE_RE = /^[+0-9][0-9 ()-]{5,19}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when `email` (trimmed) is a plausibly-valid address. Empty → false. */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function normalizePhone(phone: string): string {
  // Compare on digits only, so "+1 (555) 123" and "15551 23" match.
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Validate registration input. Consent is required; everything else is only
 * checked when provided.
 */
export function validateRegistration(input: RegistrationInput): FieldError[] {
  const errors: FieldError[] = [];

  if (!input.consent) {
    errors.push({ field: 'consent', message: 'Consent is required to create a card.' });
  }

  if (input.email && input.email.trim() && !EMAIL_RE.test(input.email.trim())) {
    errors.push({ field: 'email', message: 'Enter a valid email, or leave it blank.' });
  }

  if (input.phone && input.phone.trim() && !PHONE_RE.test(input.phone.trim())) {
    errors.push({ field: 'phone', message: 'Enter a valid phone number, or leave it blank.' });
  }

  if (input.displayName && input.displayName.trim().length > 80) {
    errors.push({ field: 'displayName', message: 'Name is too long (max 80 characters).' });
  }

  return errors;
}

/** True when registration input carries no recoverable PII at all. */
export function isTokenOnly(input: RegistrationInput): boolean {
  return !input.displayName?.trim() && !input.email?.trim() && !input.phone?.trim();
}

/**
 * Find active customers that look like duplicates of the given details, so
 * staff can be warned before creating a second card. Matches on email, phone
 * (digits-only), or exact case-insensitive name.
 */
export function findDuplicates(
  input: Pick<RegistrationInput, 'displayName' | 'email' | 'phone'>,
  existing: Customer[],
): Customer[] {
  const email = input.email?.trim() ? normalizeEmail(input.email) : undefined;
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : undefined;
  const name = input.displayName?.trim().toLowerCase();

  if (!email && !phone && !name) return [];

  return existing.filter((c) => {
    if (c.status !== 'active') return false;
    if (email && c.email && normalizeEmail(c.email) === email) return true;
    if (phone && c.phone && normalizePhone(c.phone) === phone) return true;
    if (name && c.displayName && c.displayName.trim().toLowerCase() === name) return true;
    return false;
  });
}

/**
 * Whether a customer can ever be recovered by staff search. Token-only
 * customers (no PII) cannot — this tradeoff is disclosed at registration.
 */
export function isRecoverable(customer: Customer): boolean {
  return Boolean(customer.displayName || customer.email || customer.phone);
}
