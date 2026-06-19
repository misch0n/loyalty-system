import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, ADMIN, STAFF } from '../helpers/freshStore';

let services: ReturnType<typeof freshServices>;

beforeEach(() => {
  services = freshServices();
});

describe('ConfigService', () => {
  it('seeds a sensible default config', async () => {
    const config = await services.config.get();
    expect(config.pointsPerReward).toBe(9);
    expect(config.maxPointsPerTransaction).toBe(3);
  });

  it('updates config, sanitises values, and writes an audit entry', async () => {
    const updated = await services.config.update(ADMIN, {
      pointsPerReward: 0, // sanitised up to 1
      rewardDescription: '  Free pastry  ',
    });
    expect(updated.pointsPerReward).toBe(1);
    expect(updated.rewardDescription).toBe('Free pastry');

    const audit = await services.audit.list({ action: 'config.update' });
    expect(audit).toHaveLength(1);
  });
});

describe('stats', () => {
  it('counts active customers, points issued and rewards redeemed', async () => {
    const shell = await services.customers.issueCard(STAFF);
    await services.customers.finalizeRegistration(STAFF, shell.id, { consent: true });
    await services.loyalty.accrue(STAFF, shell.id, 3);
    await services.loyalty.accrue(STAFF, shell.id, 3);
    await services.loyalty.accrue(STAFF, shell.id, 3);
    await services.loyalty.redeem(STAFF, shell.id);

    const stats = await services.loyalty.getStats();
    expect(stats.activeCustomers).toBe(1);
    expect(stats.pointsIssued).toBe(9);
    expect(stats.rewardsRedeemed).toBe(1);
  });
});
