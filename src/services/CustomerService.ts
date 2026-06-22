/**
 * CustomerService — card issuance, registration, recovery, correction, deletion.
 *
 * Orchestrates the domain (token generation, validation, duplicate detection)
 * against the `DataStore` port. Staff initiate everything here.
 */

import type { Customer } from '../domain/models';
import type { CustomerPatch, DataStore } from '../ports/DataStore';
import type { RegistrationDetails } from '../ports/Transport';
import { generateToken, isValidToken } from '../domain/tokens';
import {
  findDuplicates,
  isRecoverable,
  isTokenOnly,
  validateRegistration,
  type FieldError,
} from '../domain/validation';
import type { AuditService } from './AuditService';
import { SYSTEM_ACTOR, type Actor } from './types';

export interface RegistrationResult {
  ok: boolean;
  customer?: Customer;
  errors?: FieldError[];
}

export class CustomerService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditService,
  ) {}

  /**
   * Step 1 of registration: create a token-only shell customer. Details and
   * consent are filled in later via `finalizeRegistration`.
   */
  async issueCard(actor: Actor): Promise<Customer> {
    const customer = await this.store.createCustomer({ token: generateToken() });
    await this.audit.log(actor, 'card.issue', customer.id);
    return customer;
  }

  /**
   * Self-service registration (the primary path): the customer creates their own
   * card from their own device in one step — token + optional details + consent.
   * No staff actor and no approval queue; an empty card is harmless until a staff
   * member commits a real point. Converges on the same validation/audit pipeline
   * as staff-initiated registration. Returns the created customer (with token).
   */
  async selfRegister(details: RegistrationDetails): Promise<RegistrationResult> {
    const errors = validateRegistration(details);
    if (errors.length > 0) return { ok: false, errors };

    const customer = await this.store.createCustomer({
      token: generateToken(),
      displayName: details.displayName?.trim() || undefined,
      email: details.email?.trim() || undefined,
      phone: details.phone?.trim() || undefined,
      consentAt: new Date().toISOString(),
    });

    await this.audit.log(SYSTEM_ACTOR, 'card.issue', customer.id, 'self-register');
    await this.audit.log(
      SYSTEM_ACTOR,
      'customer.register',
      customer.id,
      isTokenOnly(details) ? 'token-only' : 'with-details',
    );
    return { ok: true, customer };
  }

  /**
   * Auto-provision on scan. Because each device has its own store, a card created
   * elsewhere (e.g. self-registered on the customer's phone) won't exist in the
   * staff device's store the first time it's scanned. If the scanned token is
   * well-formed but unknown here, create a token-only card for it so staff can
   * credit it. Staff still initiates the credit — this only makes the card known.
   */
  async provisionFromToken(actor: Actor, token: string): Promise<Customer> {
    const existing = await this.store.getCustomerByToken(token);
    if (existing) return existing;
    if (!isValidToken(token)) throw new Error('That is not a valid card code.');

    const customer = await this.store.createCustomer({ token });
    await this.audit.log(actor, 'card.provision', customer.id, 'scan');
    return customer;
  }

  /**
   * Warn-before-duplicate: return active customers that look like the given
   * details. Empty array = safe to proceed.
   */
  async checkDuplicates(details: RegistrationDetails): Promise<Customer[]> {
    const terms = [details.displayName, details.email, details.phone].filter(
      (t): t is string => Boolean(t && t.trim()),
    );
    const found = await Promise.all(terms.map((t) => this.store.findCustomers({ term: t })));
    const candidates = dedupeById(found.flat());
    return findDuplicates(details, candidates);
  }

  /**
   * Step 5: finalize the shell customer with optional details + consent.
   * Token-only (anonymous) accounts are allowed.
   */
  async finalizeRegistration(
    actor: Actor,
    customerId: string,
    details: RegistrationDetails,
  ): Promise<RegistrationResult> {
    const errors = validateRegistration(details);
    if (errors.length > 0) return { ok: false, errors };

    const patch: CustomerPatch = {
      displayName: details.displayName?.trim() || undefined,
      email: details.email?.trim() || undefined,
      phone: details.phone?.trim() || undefined,
    };
    await this.store.updateCustomer(customerId, patch);
    const customer = await this.store.recordConsent(customerId, new Date().toISOString());

    await this.audit.log(
      actor,
      'customer.register',
      customerId,
      isTokenOnly(details) ? 'token-only' : 'with-details',
    );
    return { ok: true, customer };
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
  async correct(actor: Actor, customerId: string, patch: CustomerPatch): Promise<Customer> {
    const cleaned: CustomerPatch = {
      displayName: patch.displayName?.trim() || undefined,
      email: patch.email?.trim() || undefined,
      phone: patch.phone?.trim() || undefined,
    };
    const customer = await this.store.updateCustomer(customerId, cleaned);
    await this.audit.log(actor, 'customer.correct', customerId, Object.keys(cleaned).join(','));
    return customer;
  }

  /**
   * Reissue a card. Token-rotation defaults to on (safer if the old card may be
   * in someone else's hands). Token-only customers cannot be recovered at all.
   */
  async reissue(actor: Actor, customerId: string, rotateToken = true): Promise<Customer> {
    let customer = await this.store.getCustomerById(customerId);
    if (!customer) throw new Error('Customer not found.');
    if (rotateToken) {
      customer = await this.store.rotateToken(customerId, generateToken());
    }
    await this.audit.log(
      actor,
      'card.reissue',
      customerId,
      rotateToken ? 'rotated' : 'kept-token',
    );
    return customer;
  }

  canRecover(customer: Customer): boolean {
    return isRecoverable(customer);
  }

  /** Soft delete: status → deleted, PII cleared. Honors the right to erasure. */
  async deleteCustomer(actor: Actor, customerId: string): Promise<void> {
    await this.store.softDeleteCustomer(customerId);
    await this.audit.log(actor, 'customer.delete', customerId);
  }
}

function dedupeById(customers: Customer[]): Customer[] {
  const seen = new Map<string, Customer>();
  for (const c of customers) seen.set(c.id, c);
  return [...seen.values()];
}
