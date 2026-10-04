/**
 * CustomerService — registration, lookups, correction, reissue and deletion.
 *
 * Every write here is one route, and the route does the parts that used to live
 * in this file: it generates the card's token (a client-chosen token is not a
 * credential), stamps consent, writes the audit rows from the session, and
 * sends the welcome mail. What is left is the validation a form shows before it
 * submits, and the shapes the screens consume.
 *
 * Name and email are **required** to register (SCOPE-DECISIONS §2.1); the
 * server answers `400 invalid_details` without them and `409 email_in_use` for
 * an address that already has a card, which surface as the `ApiError` they are
 * (`services/errors.ts`). The token-only shell card, and the staff-side
 * issue-then-finalize flow that built one, went with that decision.
 */

import type { Customer } from '@cafe/shared/domain/models';
import type { CustomerPatch, DataStore } from '@cafe/shared/ports/DataStore';
import {
  findDuplicates,
  validateRegistration,
  type FieldError,
  type RegistrationInput,
} from '@cafe/shared/domain/validation';

/** What a registration form collects. */
export type RegistrationDetails = RegistrationInput;

export interface RegistrationResult {
  ok: boolean;
  customer?: Customer;
  errors?: FieldError[];
}

export class CustomerService {
  constructor(private readonly store: DataStore) {}

  /**
   * Self-service registration: the customer creates their own card from their
   * own device, which `POST /customers` also binds to the new card. Field errors
   * the form can show resolve `{ ok: false, errors }`; a refusal from the server
   * throws.
   */
  async selfRegister(details: RegistrationDetails): Promise<RegistrationResult> {
    const errors = validateRegistration(details);
    if (errors.length > 0) return { ok: false, errors };

    const customer = await this.store.createCustomer({
      // The port still carries a token; `ApiStore` does not send it, and the
      // route generates its own (BACKEND-PLAN §3-B-10).
      token: '',
      displayName: details.displayName?.trim() || undefined,
      email: details.email?.trim() || undefined,
      phone: details.phone?.trim() || undefined,
    });
    return { ok: true, customer };
  }

  /**
   * Warn-before-duplicate (staff): active customers that look like the given
   * details. Empty array = safe to proceed.
   */
  async checkDuplicates(details: RegistrationDetails): Promise<Customer[]> {
    const terms = [details.displayName, details.email, details.phone].filter(
      (t): t is string => Boolean(t && t.trim()),
    );
    const found = await Promise.all(terms.map((t) => this.store.findCustomers({ term: t })));
    return findDuplicates(details, dedupeById(found.flat()));
  }

  find(term: string): Promise<Customer[]> {
    return this.store.findCustomers({ term });
  }

  getByToken(token: string): Promise<Customer | null> {
    return this.store.getCustomerByToken(token);
  }

  getById(id: string): Promise<Customer | null> {
    return this.store.getCustomerById(id);
  }

  /** Staff-mediated correction of key fields (never customer self-edit). */
  correct(customerId: string, patch: CustomerPatch): Promise<Customer> {
    return this.store.updateCustomer(customerId, {
      displayName: patch.displayName?.trim() || undefined,
      email: patch.email?.trim() || undefined,
      phone: patch.phone?.trim() || undefined,
    });
  }

  /**
   * Reissue a card with a fresh token, for a card that may be in someone else's
   * hands. The server picks the new token; the old one stops resolving.
   */
  reissue(customerId: string): Promise<Customer> {
    // As in `selfRegister`, the port's token argument is not sent.
    return this.store.rotateToken(customerId, '');
  }

  /**
   * Admin erasure. The card becomes a tombstone — PII cleared, token dead, the
   * email free for a fresh card — and the ledger keeps its integrity.
   */
  deleteCustomer(customerId: string): Promise<void> {
    return this.store.softDeleteCustomer(customerId);
  }

  /**
   * Customer self-service erasure from the card menu. The token resolves the
   * card, which also proves this device holds it; `DELETE /customers/:id` then
   * accepts the card's own device. Resolves quietly when the card is already
   * gone.
   */
  async selfDelete(token: string): Promise<void> {
    const customer = await this.store.getCustomerByToken(token);
    if (!customer || customer.status === 'deleted') return;
    await this.store.softDeleteCustomer(customer.id);
  }
}

function dedupeById(customers: Customer[]): Customer[] {
  const seen = new Map<string, Customer>();
  for (const c of customers) seen.set(c.id, c);
  return [...seen.values()];
}
