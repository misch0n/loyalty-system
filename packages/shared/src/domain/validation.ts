/**
 * Input validation + duplicate detection — pure functions.
 *
 * Name and email are **required** to register (SCOPE-DECISIONS §2.1): a card
 * without a contact address could not be recovered, so token-only accounts are
 * gone. Phone stays optional and is only rejected when present AND malformed.
 * These are the checks a form shows before it submits; `POST /customers`
 * enforces the same requirement (`400 invalid_details`) and the database backs
 * it with a CHECK.
 */

import type { Customer } from './models.js';

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
 * Validate registration input. Name, email and consent are required; phone is
 * only checked when provided.
 */
export function validateRegistration(input: RegistrationInput): FieldError[] {
  const errors: FieldError[] = [];

  if (!input.consent) {
    errors.push({ field: 'consent', message: 'Consent is required to create a card.' });
  }

  const name = input.displayName?.trim() ?? '';
  if (!name) {
    errors.push({ field: 'displayName', message: 'Enter your name.' });
  } else if (name.length > 80) {
    errors.push({ field: 'displayName', message: 'Name is too long (max 80 characters).' });
  }

  const email = input.email?.trim() ?? '';
  if (!email) {
    errors.push({ field: 'email', message: 'Enter your email address.' });
  } else if (!EMAIL_RE.test(email)) {
    errors.push({ field: 'email', message: 'Enter a valid email address.' });
  }

  if (input.phone && input.phone.trim() && !PHONE_RE.test(input.phone.trim())) {
    errors.push({ field: 'phone', message: 'Enter a valid phone number, or leave it blank.' });
  }

  return errors;
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

