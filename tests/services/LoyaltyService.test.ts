import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { alertKey } from '../../src/domain/alerts';
import { freshServices, STAFF, ADMIN } from '../helpers/freshStore';
import { SpyMailer } from '../helpers/spyMailer';
import type { LoyaltyService } from '../../src/services/LoyaltyService';
import type { CustomerService } from '../../src/services/CustomerService';

let loyalty: LoyaltyService;
let customers: CustomerService;
let config: ReturnType<typeof freshServices>['config'];
let customerId: string;

beforeEach(async () => {
  const services = freshServices();
  loyalty = services.loyalty;
  customers = services.customers;
  config = services.config;
  // Pin the threshold so these mechanics tests are independent of the product
  // default (now 9 — nine stamps, tenth coffee free).
  await services.store.updateConfig({ pointsPerReward: 8 });
  const shell = await customers.issueCard(STAFF);
  customerId = shell.id;
});

describe('accrual', () => {
  it('appends to the ledger and derives the balance', async () => {
    await loyalty.accrue(STAFF, customerId, 3);
    await loyalty.accrue(STAFF, customerId, 2);
    const state = await loyalty.getStateById(customerId);
    expect(state?.balance).toBe(5);
    expect(state?.transactions).toHaveLength(2);
  });

  it('clamps to the per-transaction cap (default 3)', async () => {
    await loyalty.accrue(STAFF, customerId, 50);
    const state = await loyalty.getStateById(customerId);
    expect(state?.balance).toBe(3);
  });
});

describe('redemption', () => {
  async function fillToThreshold() {
    await loyalty.accrue(STAFF, customerId, 3);
    await loyalty.accrue(STAFF, customerId, 3);
    await loyalty.accrue(STAFF, customerId, 2); // balance 8 == default threshold
  }

  it('redeems when eligible and subtracts the threshold', async () => {
    await fillToThreshold();
    const result = await loyalty.redeem(STAFF, customerId);
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(0);
  });

  it('refuses below the threshold', async () => {
    await loyalty.accrue(STAFF, customerId, 3);
    const result = await loyalty.redeem(STAFF, customerId);
    expect(result.ok).toBe(false);
    expect(result.balance).toBe(3);
  });

  it('is atomic — concurrent redeems cannot double-spend', async () => {
    await fillToThreshold(); // exactly one reward's worth
    const [a, b] = await Promise.all([
      loyalty.redeem(STAFF, customerId),
      loyalty.redeem(STAFF, customerId),
    ]);
    const succeeded = [a, b].filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);
    const state = await loyalty.getStateById(customerId);
    expect(state?.balance).toBe(0);
  });
});

describe('reward-available notification', () => {
  it('emails the customer once when the accrual crosses the threshold', async () => {
    const mailer = new SpyMailer();
    const services = freshServices(mailer);
    const shell = await services.customers.issueCard(STAFF);
    await services.customers.finalizeRegistration(STAFF, shell.id, {
      email: 'reward@cafe.test',
      consent: true,
    });

    // Default threshold 8, cap 3 per accrual.
    await services.loyalty.accrue(STAFF, shell.id, 3); // 3
    await services.loyalty.accrue(STAFF, shell.id, 3); // 6 — not yet at threshold
    expect(mailer.sent).toHaveLength(0);
    await services.loyalty.accrue(STAFF, shell.id, 3); // 9 — crosses 8
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].kind).toBe('reward-available');
    expect(mailer.sent[0].to).toBe('reward@cafe.test');

    await services.loyalty.accrue(STAFF, shell.id, 3); // 12 — already available, no repeat
    expect(mailer.sent).toHaveLength(1);
  });

  it('does not email a token-only customer (no contact detail)', async () => {
    const mailer = new SpyMailer();
    const services = freshServices(mailer);
    const shell = await services.customers.issueCard(STAFF);
    for (let i = 0; i < 3; i++) await services.loyalty.accrue(STAFF, shell.id, 3);
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('getAlerts', () => {
  const BASE = new Date('2026-06-23T10:00:00Z').getTime();

  // Freeze the clock (Date only, so async timers still run) so the windowed
  // detectors see deterministic timestamps.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(BASE));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Move the frozen clock to BASE + `sec` seconds. */
  function tick(sec: number) {
    vi.setSystemTime(new Date(BASE + sec * 1000));
  }

  it('derives no alerts for an ordinary accrual', async () => {
    await loyalty.accrue(STAFF, customerId, 1);
    expect(await loyalty.getAlerts()).toEqual([]);
  });

  it('flags a repeat target and resolves the staff name', async () => {
    // Default: > 3 credits to the same card by the same staff within 30 min.
    for (let i = 0; i < 4; i++) {
      tick(i * 60);
      await loyalty.accrue(STAFF, customerId, 1);
    }
    const a = (await loyalty.getAlerts()).find((x) => x.kind === 'repeat-target');
    expect(a).toBeDefined();
    expect(a?.staffId).toBe(STAFF.id);
  });

  it('honours an explicit threshold override', async () => {
    for (let i = 0; i < 4; i++) {
      tick(i * 60);
      await loyalty.accrue(STAFF, customerId, 1);
    }
    // Raise the count so the same ledger no longer flags.
    const alerts = await loyalty.getAlerts({ repeatCount: 10 });
    expect(alerts.some((x) => x.kind === 'repeat-target')).toBe(false);
  });

  it('reads detector thresholds from the program config', async () => {
    for (let i = 0; i < 4; i++) {
      tick(i * 60);
      await loyalty.accrue(STAFF, customerId, 1);
    }
    expect((await loyalty.getAlerts()).some((x) => x.kind === 'repeat-target')).toBe(true);
    await config.update(ADMIN, { repeatCount: 10 });
    expect((await loyalty.getAlerts()).some((x) => x.kind === 'repeat-target')).toBe(false);
  });

  it('flags self-dealing from REAL redemptions (the ledger no longer carries redemption)', async () => {
    // Three rounds of: credit this card to the threshold, then redeem the
    // reward it just earned, seconds later, as the same staff member.
    let key = 0;
    for (let round = 0; round < 3; round++) {
      const roundStart = round * 3600;
      for (let i = 0; i < 3; i++) {
        tick(roundStart + i * 300);
        await loyalty.commit(STAFF, {
          customerId,
          pointsDelta: 3, // 3 × 3 = 9 ≥ threshold 8 → mints one reward
          redeemRewardIds: [],
          idempotencyKey: `sd-${key++}`,
          source: 'a',
        });
      }
      const earned = (await loyalty.getState(customerId)).rewards ?? [];
      expect(earned.length).toBeGreaterThan(0);
      tick(roundStart + 2 * 300 + 5); // 5s after the credit that minted it
      await loyalty.commit(STAFF, {
        customerId,
        pointsDelta: 0,
        redeemRewardIds: [earned[0].id],
        idempotencyKey: `sd-${key++}`,
        source: 'a',
      });
    }

    const found = (await loyalty.getAlerts()).find((x) => x.kind === 'self-dealing');
    expect(found).toBeDefined();
    expect(found?.staffId).toBe(STAFF.id);
    expect(found?.customerId).toBe(customerId);
  });

  it('dismissing an alert filters it out of future reads (idempotent)', async () => {
    for (let i = 0; i < 4; i++) {
      tick(i * 60);
      await loyalty.accrue(STAFF, customerId, 1);
    }
    const flag = (await loyalty.getAlerts()).find((x) => x.kind === 'repeat-target');
    expect(flag).toBeDefined();

    await loyalty.dismissAlert(STAFF, alertKey(flag!));
    expect((await loyalty.getAlerts()).some((x) => x.kind === 'repeat-target')).toBe(false);

    // Re-dismissing the same key is a no-op (does not throw / duplicate).
    await loyalty.dismissAlert(STAFF, alertKey(flag!));
    expect((await loyalty.getAlerts()).some((x) => x.kind === 'repeat-target')).toBe(false);
  });
});

describe('unified commit (rewards-as-objects)', () => {
  // Default config: threshold 8, cap 3 per commit.
  async function accrueTo(balance: number, keyPrefix: string) {
    let added = 0;
    let i = 0;
    while (added < balance) {
      const step = Math.min(3, balance - added);
      await loyalty.commit(STAFF, {
        customerId,
        pointsDelta: step,
        redeemRewardIds: [],
        idempotencyKey: `${keyPrefix}-${i++}`,
        source: 'a',
      });
      added += step;
    }
  }

  it('accrues points and mints a reward on the threshold crossing', async () => {
    await accrueTo(6, 'k'); // below threshold — no mint
    const crossing = await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 3, // 6 → 9, crosses 8
      redeemRewardIds: [],
      idempotencyKey: 'cross',
      source: 'a',
    });
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;
    expect(crossing.minted).toHaveLength(1);
    expect(crossing.state.balance).toBe(1); // settled 0..threshold−1
    expect(crossing.state.rewards).toHaveLength(1);
  });

  it('rejects a points delta over the cap with no writes', async () => {
    const result = await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 99,
      redeemRewardIds: [],
      idempotencyKey: 'over',
      source: 'a',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('over_cap');
    // Nothing was accrued.
    const state = await loyalty.getState(customerId);
    expect(state.balance).toBe(0);
  });

  it('reports customer_not_found for an unknown customer', async () => {
    const result = await loyalty.commit(STAFF, {
      customerId: 'nope',
      pointsDelta: 1,
      redeemRewardIds: [],
      idempotencyKey: 'ghost',
      source: 'a',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('customer_not_found');
  });

  it('is idempotent — a retry with the same key returns the cached result, no double-apply', async () => {
    const first = await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 3,
      redeemRewardIds: [],
      idempotencyKey: 'once',
      source: 'a',
    });
    const retry = await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 3,
      redeemRewardIds: [],
      idempotencyKey: 'once',
      source: 'a',
    });
    expect(first).toEqual(retry);
    const state = await loyalty.getState(customerId);
    expect(state.balance).toBe(3); // applied exactly once
  });

  it('redeems an owned reward and subset-redeems an invalid id (rejected, not aborted)', async () => {
    await accrueTo(6, 'r');
    const cross = await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 3, // mint one reward
      redeemRewardIds: [],
      idempotencyKey: 'r-cross',
      source: 'a',
    });
    expect(cross.ok).toBe(true);
    if (!cross.ok) return;
    const rewardId = cross.minted[0].id;

    const redeem = await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 0,
      redeemRewardIds: [rewardId, 'stale-id'],
      idempotencyKey: 'r-redeem',
      source: 'w',
    });
    expect(redeem.ok).toBe(true);
    if (!redeem.ok) return;
    expect(redeem.redeemed).toHaveLength(1);
    expect(redeem.rejected).toEqual([{ rewardId: 'stale-id', reason: 'reward_invalid' }]);
    expect(redeem.state.rewards).toHaveLength(0); // the one reward is now spent
  });

  it('sends exactly one reward-available email per commit that mints', async () => {
    const mailer = new SpyMailer();
    const services = freshServices(mailer);
    const shell = await services.customers.issueCard(STAFF);
    await services.customers.finalizeRegistration(STAFF, shell.id, {
      email: 'commit@cafe.test',
      consent: true,
    });
    for (let i = 0; i < 2; i++) {
      await services.loyalty.commit(STAFF, {
        customerId: shell.id,
        pointsDelta: 3,
        redeemRewardIds: [],
        idempotencyKey: `m-${i}`,
        source: 'a',
      });
    }
    expect(mailer.sent).toHaveLength(0); // balance 6, no crossing yet
    await services.loyalty.commit(STAFF, {
      customerId: shell.id,
      pointsDelta: 3, // 6 → 9, mints
      redeemRewardIds: [],
      idempotencyKey: 'm-cross',
      source: 'a',
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].kind).toBe('reward-available');
  });

  it('getStats counts reward.redeemed events (the loyalty.redeem audit), not the ledger', async () => {
    await accrueTo(6, 's');
    const cross = await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 3,
      redeemRewardIds: [],
      idempotencyKey: 's-cross',
      source: 'a',
    });
    if (!cross.ok) return;
    await loyalty.commit(STAFF, {
      customerId,
      pointsDelta: 0,
      redeemRewardIds: [cross.minted[0].id],
      idempotencyKey: 's-redeem',
      source: 'a',
    });
    const stats = await loyalty.getStats();
    expect(stats.rewardsRedeemed).toBe(1);
    expect(stats.pointsIssued).toBe(9); // three +3 accruals
  });
});

describe('reversal', () => {
  it('reverses an entry with an offsetting transaction (never a destructive edit)', async () => {
    const tx = await loyalty.accrue(STAFF, customerId, 3);
    await loyalty.reverse(STAFF, customerId, tx.id);
    const state = await loyalty.getStateById(customerId);
    expect(state?.balance).toBe(0);
    expect(state?.transactions).toHaveLength(2); // original + reversal, both kept
  });

  it('refuses to reverse an entry twice', async () => {
    const tx = await loyalty.accrue(STAFF, customerId, 3);
    await loyalty.reverse(STAFF, customerId, tx.id);
    await expect(loyalty.reverse(STAFF, customerId, tx.id)).rejects.toThrow();
  });
});
