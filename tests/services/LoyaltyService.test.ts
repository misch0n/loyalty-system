import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, STAFF } from '../helpers/freshStore';
import { SpyMailer } from '../helpers/spyMailer';
import type { LoyaltyService } from '../../src/services/LoyaltyService';
import type { CustomerService } from '../../src/services/CustomerService';

let loyalty: LoyaltyService;
let customers: CustomerService;
let customerId: string;

beforeEach(async () => {
  const services = freshServices();
  loyalty = services.loyalty;
  customers = services.customers;
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
    await loyalty.accrue(STAFF, customerId, 3); // balance 9 == default threshold
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

    // Default threshold 9, cap 3 per accrual.
    await services.loyalty.accrue(STAFF, shell.id, 3); // 3
    await services.loyalty.accrue(STAFF, shell.id, 3); // 6
    expect(mailer.sent).toHaveLength(0);
    await services.loyalty.accrue(STAFF, shell.id, 3); // 9 — crosses
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
  it('derives no alerts for an ordinary accrual', async () => {
    await loyalty.accrue(STAFF, customerId, 1);
    expect(await loyalty.getAlerts()).toEqual([]);
  });

  it('flags an oversized multi-add at the cap and resolves the staff name', async () => {
    await loyalty.accrue(STAFF, customerId, 3); // default cap is 3 → at-cap flag
    const alerts = await loyalty.getAlerts();
    const a = alerts.find((x) => x.kind === 'oversized-multi-add');
    expect(a).toBeDefined();
    expect(a?.staffId).toBe(STAFF.id);
  });

  it('honours an explicit threshold override', async () => {
    await loyalty.accrue(STAFF, customerId, 3);
    // Raise the cap so the at-cap accrual no longer flags.
    const alerts = await loyalty.getAlerts({ multiAddCap: 10 });
    expect(alerts.some((x) => x.kind === 'oversized-multi-add')).toBe(false);
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
