/**
 * LoyaltyService — accrual, redemption and reversal against the append-only
 * ledger. Balance and reward-availability are derived by the domain, never
 * stored. Staff initiate every credit; redemption is atomic in the store.
 */

import type { Customer, CustomerState, LoyaltyTransaction } from '../domain/models';
import type { DataStore, RedeemResult } from '../ports/DataStore';
import type { Mailer } from '../ports/Mailer';
import { balance, clampAccrual, progress, rewardAvailable } from '../domain/loyalty';
import {
  deriveAlerts,
  alertKey,
  DEFAULT_THRESHOLDS,
  type Alert,
  type AlertThresholds,
} from '../domain/alerts';
import { appUrl } from '../config/links';
import type { AuditService } from './AuditService';
import type { Actor } from './types';

/**
 * Re-exported from the domain so existing `services/`/`ui/` imports
 * (`import type { CustomerState } from '.../LoyaltyService'`) keep working while
 * the canonical definition lives in `domain/models.ts` (so the `DataStore` port
 * can reference it without a layer inversion). See REWARDS-PLAN §3.4.
 */
export type { CustomerState } from '../domain/models';

export class LoyaltyService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditService,
    /** Optional: when present, reward-available notifications are emailed. */
    private readonly mailer?: Mailer,
  ) {}

  /** Resolve full derived state for a customer (by token, for staff scan). */
  async getStateByToken(token: string): Promise<CustomerState | null> {
    const customer = await this.store.getCustomerByToken(token);
    if (!customer) return null;
    return this.buildState(customer);
  }

  async getStateById(customerId: string): Promise<CustomerState | null> {
    const customer = await this.store.getCustomerById(customerId);
    if (!customer) return null;
    return this.buildState(customer);
  }

  /** Resolve a customer by their human-shareable short code (camera-fail entry). */
  async getStateByShortCode(shortCode: string): Promise<CustomerState | null> {
    const customer = await this.store.getCustomerByShortCode(shortCode);
    if (!customer) return null;
    return this.buildState(customer);
  }

  private async buildState(customer: Customer): Promise<CustomerState> {
    const [config, transactions] = await Promise.all([
      this.store.getConfig(),
      this.store.listTransactions(customer.id),
    ]);
    const current = balance(transactions);
    return {
      customer,
      config,
      transactions,
      balance: current,
      rewardAvailable: rewardAvailable(current, config),
      progress: progress(current, config),
    };
  }

  /** Basic counts for the admin stats screen (no segmentation in v1). */
  async getStats(): Promise<{
    activeCustomers: number;
    pointsIssued: number;
    rewardsRedeemed: number;
  }> {
    const [activeCustomers, transactions] = await Promise.all([
      this.store.countActiveCustomers(),
      this.store.listAllTransactions(),
    ]);
    let pointsIssued = 0;
    let rewardsRedeemed = 0;
    for (const tx of transactions) {
      if (tx.type === 'accrual') pointsIssued += tx.points;
      if (tx.type === 'redemption') rewardsRedeemed += 1;
    }
    return { activeCustomers, pointsIssued, rewardsRedeemed };
  }

  /**
   * Derive the suspicious-activity alerts for the admin view (UX §8.1). Pulls
   * the whole ledger + config + staff names and runs the pure heuristics. The
   * multi-add cap defaults to the program's `maxPointsPerTransaction`; pass
   * `thresholds` to override any field. Monitoring only — never blocks.
   */
  async getAlerts(thresholds?: Partial<AlertThresholds>): Promise<Alert[]> {
    const [transactions, config, staff] = await Promise.all([
      this.store.listAllTransactions(),
      this.store.getConfig(),
      this.store.listStaff(),
    ]);
    const resolved: AlertThresholds = {
      ...DEFAULT_THRESHOLDS,
      multiAddCap: config.maxPointsPerTransaction,
      ...thresholds,
    };
    const staffNames: Record<string, string> = {};
    for (const member of staff) staffNames[member.id] = member.username;
    const dismissed = new Set(config.dismissedAlerts ?? []);
    return deriveAlerts(transactions, resolved, staffNames).filter(
      (a) => !dismissed.has(alertKey(a)),
    );
  }

  /**
   * Acknowledge/dismiss a suspicious-activity alert so it stops surfacing.
   * Records the alert's stable key on the program config and audits the action.
   * Idempotent — re-dismissing the same key is a no-op.
   */
  async dismissAlert(actor: Actor, key: string): Promise<void> {
    const config = await this.store.getConfig();
    const current = config.dismissedAlerts ?? [];
    if (current.includes(key)) return;
    await this.store.updateConfig({ dismissedAlerts: [...current, key] });
    await this.audit.log(actor, 'config.update', undefined, 'alert.dismiss');
  }

  /** Add points (clamped to the per-transaction cap). Staff-initiated. */
  async accrue(
    actor: Actor,
    customerId: string,
    requestedPoints: number,
    note?: string,
  ): Promise<LoyaltyTransaction> {
    const config = await this.store.getConfig();
    const points = clampAccrual(requestedPoints, config);
    const before = balance(await this.store.listTransactions(customerId));
    const tx = await this.store.appendTransaction({
      customerId,
      type: 'accrual',
      points,
      staffId: actor.id,
      note,
    });
    await this.audit.log(actor, 'loyalty.accrue', customerId, `+${points}`);

    // Notify on the threshold crossing only (no repeat once already available).
    // Awaited but self-contained: notifyRewardAvailable never throws, so a failed
    // send cannot break the accrual.
    if (!rewardAvailable(before, config) && rewardAvailable(before + points, config)) {
      await this.notifyRewardAvailable(customerId);
    }
    return tx;
  }

  /** Best-effort reward-available email. Never blocks or fails an accrual. */
  private async notifyRewardAvailable(customerId: string): Promise<void> {
    if (!this.mailer) return;
    try {
      const [customer, config] = await Promise.all([
        this.store.getCustomerById(customerId),
        this.store.getConfig(),
      ]);
      if (!customer || customer.status !== 'active' || !customer.email) return;
      const link = appUrl(`/status/${customer.token}`);
      await this.mailer.send({
        to: customer.email,
        kind: 'reward-available',
        params: {
          reward: config.rewardDescription,
          card_link: link,
          subject: `Your ${config.rewardDescription} is ready`,
          message: `You've earned a reward: ${config.rewardDescription}. Show your card on your next visit to redeem it.\n\nView your card: ${link}`,
        },
      });
    } catch {
      // Transactional email is a best-effort side channel. Swallow failures and
      // do NOT log — an error could carry the recipient address (PII).
    }
  }

  /** Redeem one reward. Delegates the atomic check+write to the store. */
  async redeem(actor: Actor, customerId: string): Promise<RedeemResult> {
    const result = await this.store.redeemReward(customerId, actor.id);
    if (result.ok) {
      await this.audit.log(actor, 'loyalty.redeem', customerId);
    }
    return result;
  }

  /**
   * Reverse a recent accrual or redemption (wrong customer / fat-finger). Writes
   * a `reversal` entry that negates the original — never a destructive edit.
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

    const tx = await this.store.appendTransaction({
      customerId,
      type: 'reversal',
      points: -original.points,
      staffId: actor.id,
      note,
      reversesTransactionId: transactionId,
    });
    await this.audit.log(actor, 'loyalty.reverse', customerId, transactionId);
    return tx;
  }
}
