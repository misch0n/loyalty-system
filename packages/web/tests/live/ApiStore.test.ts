/**
 * `ApiStore` against the real server, for the port methods no service reaches.
 *
 * The services' suites cover most of the port through the screens' own calls.
 * What is left is pinned here, so every `DataStore` method `ApiStore` carries
 * has been answered by the real API at least once — except `importAll`, which
 * replaces the whole database the rest of the run is using.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adminDevice, customerPhone, signedIn } from './harness';

describe('ApiStore — the rest of the port, live', () => {
  it('lists a card’s ledger and rewards, filtered by status', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const store = till.services.store;
    const { pointsPerReward } = await store.getConfig();

    const minted = await store.commitCounterTransaction({
      customerId: phone.customer.id,
      pointsDelta: Math.min(pointsPerReward, (await store.getConfig()).maxPointsPerTransaction),
      redeemRewardIds: [],
      staffId: till.actor.id,
      idempotencyKey: randomUUID(),
      source: 'a',
    });
    expect(minted.ok).toBe(true);

    const ledger = await store.listTransactions(phone.customer.id);
    expect(ledger.some((t) => t.type === 'accrual')).toBe(true);
    // The card's own phone reads the same ledger.
    expect(await phone.services.store.listTransactions(phone.customer.id)).toEqual(ledger);

    const all = await store.listRewards(phone.customer.id);
    expect(await store.listRewards(phone.customer.id, 'spent')).toEqual([]);
    expect(await store.listRewards(phone.customer.id, 'unspent')).toEqual(all);
  });

  it('appends an accrual through the correction route, clamped by the server', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const { maxPointsPerTransaction } = await till.services.store.getConfig();

    const tx = await till.services.store.appendTransaction({
      customerId: phone.customer.id,
      type: 'accrual',
      points: maxPointsPerTransaction + 50,
      // Ignored: the route takes the actor from the session.
      staffId: 'someone-else',
    });
    expect(tx).toMatchObject({ type: 'accrual', points: maxPointsPerTransaction, staffId: till.actor.id });
  });

  it('records consent — stamped by the server', async () => {
    const phone = await customerPhone();
    const till = await signedIn('staff');
    const updated = await till.services.store.recordConsent(phone.customer.id, '1999-01-01T00:00:00Z');
    expect(updated.consentAt).toBeTruthy();
    expect(updated.consentAt).not.toBe('1999-01-01T00:00:00Z');
  });

  it('narrows the audit read by time and count, never by actor', async () => {
    const till = await signedIn('staff');
    const since = new Date(Date.now() - 60_000).toISOString();
    const rows = await till.services.store.listAudit({ from: since, limit: 1, actorId: 'not-me' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(till.actor.id);
  });

  it('counts active customers and exports a snapshot, for an admin', async () => {
    await customerPhone();
    const admin = await adminDevice();
    expect(await admin.services.store.countActiveCustomers()).toBeGreaterThan(0);

    const snapshot = await admin.services.store.exportAll();
    expect(snapshot.customers.length).toBeGreaterThan(0);
    // The export never carries a credential.
    for (const account of snapshot.staff) expect(account.passwordHash ?? '').toBe('');
  });
});
