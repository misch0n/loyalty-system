/**
 * ApiStore — the client half of the seam, still a SKELETON.
 *
 * Every method maps to an HTTP call against the Fastify API, which now exists
 * (`packages/server/`). The bodies show the intended request shape and throw:
 * `request` is the piece that is not written, and it is not a small one —
 * `credentials: 'include'`, the CSRF header echoed from the script-readable
 * cookie, and one typed error surface for the refusals every screen can now
 * meet. That is **UI-pass work** (BACKEND-PLAN, *UI pass*), because it cannot be
 * finished without deciding how a failed call reaches a screen
 * (`UI-RECONCILIATION.md` X2).
 *
 * What it does carry today is the shape of the contract, kept honest against the
 * port. Phase 6 removed four methods from it — `redeemReward`, `getStaffByPin`,
 * `appendAudit` and the by-value recovery pair — because the port removed them:
 * each is something a client must not be able to ask for at all, rather than
 * something a route refuses (see `DataStore`'s header and `TrustedStore`).
 */

import type {
  AppendTransactionInput,
  AuditFilter,
  CommitResult,
  CounterTransaction,
  CreateCustomerInput,
  CreateStaffInput,
  CustomerPatch,
  CustomerQuery,
  DataStore,
} from '@cafe/shared/ports/DataStore';
import type {
  AuditLogEntry,
  Customer,
  CustomerState,
  LoyaltyTransaction,
  ProgramConfig,
  Reward,
  RewardStatus,
  Snapshot,
  StaffAccount,
} from '@cafe/shared/domain/models';

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
  getCustomerByShortCode(shortCode: string): Promise<Customer | null> {
    return this.request('GET', `/customers/by-code/${shortCode}`);
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
  commitCounterTransaction(txn: CounterTransaction): Promise<CommitResult> {
    return this.request('POST', `/customers/${txn.customerId}/commit`, txn);
  }
  listRewards(customerId: string, status?: RewardStatus): Promise<Reward[]> {
    const query = status ? `?status=${status}` : '';
    return this.request('GET', `/customers/${customerId}/rewards${query}`);
  }
  getCustomerState(customerId: string): Promise<CustomerState> {
    return this.request('GET', `/customers/${customerId}/state`);
  }

  // Recovery has no store methods here: the client cannot name the customer a
  // code belongs to, and the scoping is the whole security of a six-character
  // code. It is two public routes — `POST /recovery/request` (address) and
  // `POST /recovery/consume` (address + code) — which `RecoveryService` is
  // rewritten against in the UI pass (`UI-RECONCILIATION.md` C3).

  createStaff(input: CreateStaffInput): Promise<StaffAccount> {
    return this.request('POST', '/staff', input);
  }
  getStaffByUsername(username: string): Promise<StaffAccount | null> {
    return this.request('GET', `/staff/by-username/${encodeURIComponent(username)}`);
  }
  // No `getStaffByPin`: "which account has this PIN?" over HTTP is a credential
  // oracle across the whole staff table at four digits (BACKEND-PLAN §4-B). PIN
  // re-auth is `POST /auth/unlock`, against the account the session already
  // names — which means a device with no session cannot PIN in at all
  // (`UI-RECONCILIATION.md` S1).
  setStaffActive(id: string, active: boolean): Promise<void> {
    return this.request('PATCH', `/staff/${id}`, { active });
  }
  setStaffPassword(id: string, password: string): Promise<void> {
    // The plaintext, over TLS. The server hashes it with argon2id; a client that
    // hashed would make its digest the credential (BACKEND-PLAN §4-A).
    return this.request('PATCH', `/staff/${id}/password`, { password });
  }
  setStaffPin(id: string, pin: string): Promise<void> {
    // Production hashes/verifies the PIN server-side; the shape is illustrative.
    return this.request('PATCH', `/staff/${id}/pin`, { pin });
  }
  deleteStaff(id: string): Promise<void> {
    return this.request('DELETE', `/staff/${id}`);
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

  // No `appendAudit`: a client-supplied actor and action is not an audit log
  // (BACKEND-PLAN §4-C). Route handlers write their own rows from the session;
  // `POST /audit` answers 204 and writes nothing.
  listAudit(filter: AuditFilter = {}): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (filter.action) params.set('action', filter.action);
    if (filter.actions?.length) params.set('actions', filter.actions.join(','));
    if (filter.actorId) params.set('actorId', filter.actorId);
    if (filter.actorIds?.length) params.set('actorIds', filter.actorIds.join(','));
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
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
