/**
 * ApiStore — PRODUCTION SKELETON (stub).
 *
 * Implements the exact same `DataStore` contract as `IndexedDbStore`, but each
 * method maps to an HTTP call against the Node backend. It ships here as a
 * clearly-marked stub so the contract is visible and the prototype→production
 * swap is a ONE-LINE wiring change in the composition root (pick `ApiStore`
 * instead of `IndexedDbStore`). No UI or service call site changes.
 *
 * The method bodies show the intended request shape but throw, because the
 * prototype has no backend. Implement them when the Node + Postgres API exists.
 */

import type {
  AppendAuditInput,
  AppendTransactionInput,
  AuditFilter,
  CreateCustomerInput,
  CreateStaffInput,
  CustomerPatch,
  CustomerQuery,
  DataStore,
  RedeemResult,
} from '../../ports/DataStore';
import type {
  AuditLogEntry,
  Customer,
  LoyaltyTransaction,
  ProgramConfig,
  Snapshot,
  StaffAccount,
} from '../../domain/models';

export interface ApiStoreOptions {
  baseUrl: string;
  /** Returns the current auth token for the Authorization header. */
  getAuthToken?: () => string | null;
}

export class ApiStore implements DataStore {
  constructor(private readonly options: ApiStoreOptions) {}

  /** Single choke point for every backend call. Throws in the prototype. */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Production implementation (illustrative):
    //
    //   const res = await fetch(`${this.options.baseUrl}${path}`, {
    //     method,
    //     headers: {
    //       'Content-Type': 'application/json',
    //       ...(this.options.getAuthToken?.()
    //         ? { Authorization: `Bearer ${this.options.getAuthToken()}` }
    //         : {}),
    //     },
    //     body: body === undefined ? undefined : JSON.stringify(body),
    //   });
    //   if (!res.ok) throw new Error(`API ${method} ${path} failed: ${res.status}`);
    //   return (await res.json()) as T;
    //
    void this.options;
    void body;
    throw new Error(
      `ApiStore is a production stub — no backend in the prototype (${method} ${path}).`,
    );
  }

  createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return this.request('POST', '/customers', input);
  }
  getCustomerById(id: string): Promise<Customer | null> {
    return this.request('GET', `/customers/${id}`);
  }
  getCustomerByToken(token: string): Promise<Customer | null> {
    return this.request('GET', `/customers/by-token/${token}`);
  }
  findCustomers(query: CustomerQuery): Promise<Customer[]> {
    return this.request('GET', `/customers?term=${encodeURIComponent(query.term)}`);
  }
  updateCustomer(id: string, patch: CustomerPatch): Promise<Customer> {
    return this.request('PATCH', `/customers/${id}`, patch);
  }
  recordConsent(id: string, consentAt: string): Promise<Customer> {
    return this.request('POST', `/customers/${id}/consent`, { consentAt });
  }
  rotateToken(id: string, token: string): Promise<Customer> {
    return this.request('POST', `/customers/${id}/rotate-token`, { token });
  }
  softDeleteCustomer(id: string): Promise<void> {
    return this.request('DELETE', `/customers/${id}`);
  }

  appendTransaction(tx: AppendTransactionInput): Promise<LoyaltyTransaction> {
    return this.request('POST', `/customers/${tx.customerId}/transactions`, tx);
  }
  listTransactions(customerId: string): Promise<LoyaltyTransaction[]> {
    return this.request('GET', `/customers/${customerId}/transactions`);
  }
  redeemReward(customerId: string, staffId: string): Promise<RedeemResult> {
    return this.request('POST', `/customers/${customerId}/redeem`, { staffId });
  }

  createStaff(input: CreateStaffInput): Promise<StaffAccount> {
    return this.request('POST', '/staff', input);
  }
  getStaffByUsername(username: string): Promise<StaffAccount | null> {
    return this.request('GET', `/staff/by-username/${encodeURIComponent(username)}`);
  }
  setStaffActive(id: string, active: boolean): Promise<void> {
    return this.request('PATCH', `/staff/${id}`, { active });
  }
  setStaffPassword(id: string, passwordHash: string): Promise<void> {
    return this.request('PATCH', `/staff/${id}/password`, { passwordHash });
  }
  listStaff(): Promise<StaffAccount[]> {
    return this.request('GET', '/staff');
  }
  getConfig(): Promise<ProgramConfig> {
    return this.request('GET', '/config');
  }
  updateConfig(patch: Partial<ProgramConfig>): Promise<ProgramConfig> {
    return this.request('PATCH', '/config', patch);
  }

  appendAudit(entry: AppendAuditInput): Promise<void> {
    return this.request('POST', '/audit', entry);
  }
  listAudit(filter: AuditFilter = {}): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (filter.action) params.set('action', filter.action);
    if (filter.actorId) params.set('actorId', filter.actorId);
    if (filter.limit) params.set('limit', String(filter.limit));
    return this.request('GET', `/audit?${params.toString()}`);
  }

  countActiveCustomers(): Promise<number> {
    return this.request('GET', '/stats/active-customers');
  }
  listAllTransactions(): Promise<LoyaltyTransaction[]> {
    return this.request('GET', '/transactions');
  }

  exportAll(): Promise<Snapshot> {
    return this.request('GET', '/export');
  }
  importAll(snapshot: Snapshot): Promise<void> {
    return this.request('POST', '/import', snapshot);
  }
}
