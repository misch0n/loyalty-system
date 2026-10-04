/**
 * ApiStore — the `DataStore` port over HTTP, and the only `DataStore` the SPA has.
 *
 * Each method is one route of `packages/server/src/routes/`, called through
 * {@link ApiClient.request}, which owns the cookies, the CSRF header, JSON and
 * the one typed failure ({@link ApiError}). This file owns only the mapping:
 * which route, and what of the port's argument the route actually reads.
 *
 * ## Where the port and the routes differ
 *
 * The port was written for an in-process store, so some of what it passes is
 * the server's to decide, and is **not sent**:
 *   - `createCustomer`'s `token` and `consentAt` — the route generates the token
 *     (a client-chosen token is not a credential) and stamps consent itself.
 *   - `rotateToken`'s `token` and `recordConsent`'s `consentAt`, likewise.
 *   - `appendTransaction`'s and `commitCounterTransaction`'s `staffId` — the
 *     actor is the session's, never the body's (BACKEND-PLAN §4-D).
 *   - `listAudit`'s `actorId`/`actorIds` — `GET /audit` replaces them with the
 *     session's own (§4-F), so sending them would only suggest they work.
 *
 * Two port methods have **no route**, and reject rather than pretend:
 * `getStaffByUsername` (sign-in is `POST /auth/login`; a username lookup over
 * HTTP would be an account-enumeration oracle) and `listAllTransactions` (the
 * ledger is only served ranged and capped, `GET /transactions?from&to`). Who
 * stops calling them is UI-2's call (`UI-RECONCILIATION.md` P9).
 *
 * ## Absence is a value, not a failure
 *
 * The port's lookups answer `null` for "no such card", so a 404 from one of
 * them resolves to `null` here instead of throwing. The counter commit's
 * refusals (`over_cap`, `customer_not_found`) are a `CommitResult` value in the
 * port, so their refusal body is returned rather than thrown. Everything else
 * that fails throws an `ApiError`.
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
import type { ApiClient } from '../http/ApiClient';
import { isApiError } from '../http/ApiError';

const seg = encodeURIComponent;

export class ApiStore implements DataStore {
  constructor(private readonly api: ApiClient) {}

  /** A lookup whose 404 means "none": resolves `null` instead of throwing. */
  private async orNull<T>(path: string): Promise<T | null> {
    try {
      return await this.api.request<T>('GET', path);
    } catch (err) {
      if (isApiError(err) && err.failure.kind === 'not_found') return null;
      throw err;
    }
  }

  private unrouted(method: string, instead: string): Promise<never> {
    return Promise.reject(
      new Error(`ApiStore.${method} has no route on the API — ${instead} (UI-RECONCILIATION P9).`),
    );
  }

  // ── customers ───────────────────────────────────────────────────────────────
  createCustomer(input: CreateCustomerInput): Promise<Customer> {
    // Public registration. Off a till it also binds this device to the new card.
    return this.api.request('POST', '/customers', {
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
    });
  }
  getCustomerById(id: string): Promise<Customer | null> {
    return this.orNull(`/customers/${seg(id)}`);
  }
  getCustomerByToken(token: string): Promise<Customer | null> {
    // Off a till this also binds the card to this device (the identity cookie).
    return this.orNull(`/customers/by-token/${seg(token)}`);
  }
  getCustomerByShortCode(shortCode: string): Promise<Customer | null> {
    return this.orNull(`/customers/by-code/${seg(shortCode)}`);
  }
  findCustomers(query: CustomerQuery): Promise<Customer[]> {
    // A POST so the term — a name, an email, a phone — stays out of the URL.
    return this.api.request('POST', '/customers/search', { term: query.term });
  }
  updateCustomer(id: string, patch: CustomerPatch): Promise<Customer> {
    return this.api.request('PATCH', `/customers/${seg(id)}`, patch);
  }
  recordConsent(id: string, _consentAt: string): Promise<Customer> {
    return this.api.request('POST', `/customers/${seg(id)}/consent`);
  }
  rotateToken(id: string, _token: string): Promise<Customer> {
    return this.api.request('POST', `/customers/${seg(id)}/rotate-token`);
  }
  softDeleteCustomer(id: string): Promise<void> {
    return this.api.request('DELETE', `/customers/${seg(id)}`);
  }

  // ── ledger & rewards ────────────────────────────────────────────────────────
  appendTransaction(tx: AppendTransactionInput): Promise<LoyaltyTransaction> {
    return this.api.request('POST', `/customers/${seg(tx.customerId)}/transactions`, {
      type: tx.type,
      points: tx.points,
      note: tx.note,
      reversesTransactionId: tx.reversesTransactionId,
    });
  }
  listTransactions(customerId: string): Promise<LoyaltyTransaction[]> {
    return this.api.request('GET', `/customers/${seg(customerId)}/transactions`);
  }
  async commitCounterTransaction(txn: CounterTransaction): Promise<CommitResult> {
    try {
      return await this.api.request<CommitResult>('POST', `/customers/${seg(txn.customerId)}/commit`, {
        pointsDelta: txn.pointsDelta,
        redeemRewardIds: txn.redeemRewardIds,
        idempotencyKey: txn.idempotencyKey,
        source: txn.source,
      });
    } catch (err) {
      const refusal = commitRefusal(err);
      if (refusal) return refusal;
      throw err;
    }
  }
  listRewards(customerId: string, status?: RewardStatus): Promise<Reward[]> {
    const query = status ? `?status=${seg(status)}` : '';
    return this.api.request('GET', `/customers/${seg(customerId)}/rewards${query}`);
  }
  getCustomerState(customerId: string): Promise<CustomerState> {
    return this.api.request('GET', `/customers/${seg(customerId)}/state`);
  }

  // Recovery has no store methods here: the client cannot name the customer a
  // code belongs to, and the scoping is the whole security of a six-character
  // code. It is two public routes — `POST /recovery/request` (address) and
  // `POST /recovery/consume` (address + code) — which `RecoveryService` is
  // rewritten against in UI-2 (`UI-RECONCILIATION.md` C3).

  // ── staff & config ──────────────────────────────────────────────────────────
  createStaff(input: CreateStaffInput): Promise<StaffAccount> {
    // The plaintext, over TLS. The server hashes it with argon2id; a client that
    // hashed would make its digest the credential (BACKEND-PLAN §4-A).
    return this.api.request('POST', '/staff', {
      username: input.username,
      password: input.password,
      role: input.role,
      name: input.name,
    });
  }
  getStaffByUsername(_username: string): Promise<StaffAccount | null> {
    return this.unrouted('getStaffByUsername', 'sign in with POST /auth/login');
  }
  setStaffActive(id: string, active: boolean): Promise<void> {
    return this.api.request('PATCH', `/staff/${seg(id)}`, { active });
  }
  setStaffPassword(id: string, password: string): Promise<void> {
    return this.api.request('PATCH', `/staff/${seg(id)}/password`, { password });
  }
  deleteStaff(id: string): Promise<void> {
    return this.api.request('DELETE', `/staff/${seg(id)}`);
  }
  listStaff(): Promise<StaffAccount[]> {
    return this.api.request('GET', '/staff');
  }
  getConfig(): Promise<ProgramConfig> {
    return this.api.request('GET', '/config');
  }
  updateConfig(patch: Partial<ProgramConfig>): Promise<ProgramConfig> {
    return this.api.request('PATCH', '/config', patch);
  }

  // No `appendAudit`: a client-supplied actor and action is not an audit log
  // (BACKEND-PLAN §4-C). Route handlers write their own rows from the session.
  listAudit(filter: AuditFilter = {}): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (filter.action) params.set('action', filter.action);
    if (filter.actions?.length) params.set('actions', filter.actions.join(','));
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    if (filter.limit) params.set('limit', String(filter.limit));
    const query = params.toString();
    return this.api.request('GET', query ? `/audit?${query}` : '/audit');
  }

  // ── stats & backup ──────────────────────────────────────────────────────────
  countActiveCustomers(): Promise<number> {
    return this.api.request('GET', '/stats/active-customers');
  }
  listAllTransactions(): Promise<LoyaltyTransaction[]> {
    return this.unrouted('listAllTransactions', 'the ledger is served ranged, GET /transactions?from&to');
  }
  exportAll(): Promise<Snapshot> {
    return this.api.request('GET', '/export');
  }
  importAll(snapshot: Snapshot): Promise<void> {
    return this.api.request('POST', '/import', snapshot);
  }
}

/**
 * The commit route answers its refusals with the port's own `{ ok: false }`
 * shape (400 `over_cap`, 404 `customer_not_found`). `ApiClient` threw them as
 * failures; they are values here. A schema refusal (`invalid_request`) is not
 * one of them and stays an error.
 */
function commitRefusal(err: unknown): CommitResult | null {
  if (!isApiError(err)) return null;
  const { failure } = err;
  if (failure.kind === 'rejected' && failure.code === 'over_cap') {
    return { ok: false, error: 'over_cap' };
  }
  if (failure.kind === 'not_found' && failure.code === 'customer_not_found') {
    return { ok: false, error: 'customer_not_found' };
  }
  return null;
}
