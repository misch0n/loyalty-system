/**
 * LoyaltyService — the counter commit, the derived card state, corrections, and
 * the admin's suspicious-activity alerts.
 *
 * The ledger is append-only and the state is derived — on the server now, which
 * answers `GET /customers/:id/state` with the same `domain/` derivation the
 * prototype ran in the browser. Staff initiate every credit; the commit is
 * atomic and idempotent in the store; and the route writes the audit rows and
 * sends the reward-available mail itself, so a retried commit can do neither
 * twice. Nothing here writes an audit row or sends mail.
 */

import type { CustomerState, LoyaltyTransaction } from '@cafe/shared/domain/models';
import type { CommitResult, CounterTransaction, DataStore } from '@cafe/shared/ports/DataStore';
import type { Alert } from '@cafe/shared/domain/alerts';
import type { Actor, Api } from './types';

/**
 * Re-exported from the domain so `services/`/`ui/` imports
 * (`import type { CustomerState } from '.../LoyaltyService'`) keep working while
 * the canonical definition lives in `domain/models.ts`.
 */
export type { CustomerState } from '@cafe/shared/domain/models';

/** Re-exported so screens consume the commit result from the service layer. */
export type { CommitResult } from '@cafe/shared/ports/DataStore';

/**
 * What the counter submits for the unified commit (REWARDS-PLAN §3.3): the
 * customer, the points to add, the reward ids to redeem, the dedup key, and the
 * scan source.
 */
export interface CommitInput {
  customerId: string;
  /** Points to add this commit (0 ⇒ redeem-only). Over the cap ⇒ `over_cap`. */
  pointsDelta: number;
  /** Reward ids to redeem this commit (0..10). Invalid ids land in `rejected[]`. */
  redeemRewardIds: string[];
  /** Dedup key — a retry with the same key returns the cached result, no re-writes. */
  idempotencyKey: string;
  /** Scan origin: 'a' = app camera, 'w' = wallet. Recorded on audit; nothing else. */
  source: 'a' | 'w';
}

export class LoyaltyService {
  constructor(
    private readonly store: DataStore,
    private readonly api: Api,
  ) {}

  /**
   * The card's state, by token. Resolving the token is also what binds a
   * customer's own device to the card (a till is exempt), so this is the read
   * the card screen opens with.
   */
  async getStateByToken(token: string): Promise<CustomerState | null> {
    const customer = await this.store.getCustomerByToken(token);
    return customer ? this.store.getCustomerState(customer.id) : null;
  }

  async getStateById(customerId: string): Promise<CustomerState | null> {
    const customer = await this.store.getCustomerById(customerId);
    return customer ? this.store.getCustomerState(customer.id) : null;
  }

  /** Resolve a customer by their human-shareable short code (camera-fail entry, staff). */
  async getStateByShortCode(shortCode: string): Promise<CustomerState | null> {
    const customer = await this.store.getCustomerByShortCode(shortCode);
    return customer ? this.store.getCustomerState(customer.id) : null;
  }

  /** Full derived read-model (settled balance + unspent rewards) for a customer. */
  getState(customerId: string): Promise<CustomerState> {
    return this.store.getCustomerState(customerId);
  }

  /**
   * The suspicious-activity findings for the admin view (Appendix E) —
   * `GET /alerts`, derived server-side from the audit rows the routes wrote.
   * Two detectors, thresholds from the program config, dismissed alerts already
   * filtered out. The server looks back **30 days**; the prototype read
   * everything it had.
   */
  getAlerts(): Promise<Alert[]> {
    return this.api.request('GET', '/alerts');
  }

  /**
   * Acknowledge an alert so it stops surfacing: its stable key joins the
   * config's dismissed list (`PATCH /config`, audited by the route).
   * Idempotent — re-dismissing the same key writes nothing.
   */
  async dismissAlert(key: string): Promise<void> {
    const config = await this.store.getConfig();
    const current = config.dismissedAlerts ?? [];
    if (current.includes(key)) return;
    await this.store.updateConfig({ dismissedAlerts: [...current, key] });
  }

  /**
   * Reverse a recent accrual (wrong customer / fat-finger) with a `reversal`
   * entry that negates it — never a destructive edit. The checks here are
   * advisory, for a sentence instead of a refusal code; the route repeats them
   * and derives the reversed points itself.
   */
  async reverse(
    actor: Actor,
    customerId: string,
    transactionId: string,
    note?: string,
  ): Promise<LoyaltyTransaction> {
    const transactions = await this.store.listTransactions(customerId);
    const original = transactions.find((t) => t.id === transactionId);
    if (!original) throw new Error('That entry was not found for this customer.');
    if (original.type === 'reversal') throw new Error('A reversal cannot be reversed.');
    if (transactions.some((t) => t.reversesTransactionId === transactionId)) {
      throw new Error('That entry has already been reversed.');
    }
    return this.store.appendTransaction({
      customerId,
      type: 'reversal',
      points: -original.points,
      // The port's field; the route takes the actor from the session instead.
      staffId: actor.id,
      note,
      reversesTransactionId: transactionId,
    });
  }

  /**
   * The single counter mutation: accrue points, mint a reward per threshold
   * crossing, and redeem 0..N existing rewards — one atomic, idempotent call.
   * `over_cap` and `customer_not_found` come back as values; nothing is written.
   */
  commit(actor: Actor, input: CommitInput): Promise<CommitResult> {
    const txn: CounterTransaction = {
      customerId: input.customerId,
      pointsDelta: input.pointsDelta,
      redeemRewardIds: input.redeemRewardIds,
      // The port's field; the route takes the actor from the session instead.
      staffId: actor.id,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
    };
    return this.store.commitCounterTransaction(txn);
  }
}
