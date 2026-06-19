import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, STAFF } from '../helpers/freshStore';
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
