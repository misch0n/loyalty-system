/**
 * ApiStore is the production HTTP skeleton: it implements the full DataStore
 * contract but every method throws in the prototype (no backend). These tests
 * pin that contract — the surface exists, and each call fails loudly rather than
 * silently no-opping — so the prototype→production swap stays a wiring change.
 */
import { describe, it, expect } from 'vitest';
import { ApiStore } from '../../src/adapters/storage/ApiStore';
import type { DataStore } from '../../src/ports/DataStore';

function makeStore(): DataStore {
  return new ApiStore({ baseUrl: '/api' });
}

const snapshot = {
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  config: {
    pointsPerReward: 9,
    rewardDescription: 'x',
    pointsPerPurchase: 1,
    maxPointsPerTransaction: 3,
    cardInactivityDays: 0,
  },
  staff: [],
  customers: [],
  transactions: [],
  audit: [],
};

// Every DataStore method, invoked with throwaway args. Each must reject.
const calls: Array<[string, (s: DataStore) => Promise<unknown>]> = [
  ['createCustomer', (s) => s.createCustomer({ token: 't' })],
  ['getCustomerById', (s) => s.getCustomerById('id')],
  ['getCustomerByToken', (s) => s.getCustomerByToken('t')],
  ['findCustomers', (s) => s.findCustomers({ term: 'q' })],
  ['updateCustomer', (s) => s.updateCustomer('id', { displayName: 'x' })],
  ['recordConsent', (s) => s.recordConsent('id', 'now')],
  ['rotateToken', (s) => s.rotateToken('id', 't')],
  ['softDeleteCustomer', (s) => s.softDeleteCustomer('id')],
  ['appendTransaction', (s) => s.appendTransaction({ customerId: 'c', type: 'accrual', points: 1, staffId: 's' })],
  ['listTransactions', (s) => s.listTransactions('c')],
  ['redeemReward', (s) => s.redeemReward('c', 's')],
  ['createStaff', (s) => s.createStaff({ username: 'u', passwordHash: 'p', role: 'staff' })],
  ['getStaffByUsername', (s) => s.getStaffByUsername('u')],
  ['setStaffActive', (s) => s.setStaffActive('id', true)],
  ['setStaffPassword', (s) => s.setStaffPassword('id', 'p')],
  ['listStaff', (s) => s.listStaff()],
  ['getConfig', (s) => s.getConfig()],
  ['updateConfig', (s) => s.updateConfig({ pointsPerReward: 1 })],
  ['appendAudit', (s) => s.appendAudit({ actorId: 'a', actorRole: 'admin', action: 'card.issue' })],
  ['listAudit', (s) => s.listAudit({ action: 'card.issue', actorId: 'a', limit: 5 })],
  ['countActiveCustomers', (s) => s.countActiveCustomers()],
  ['listAllTransactions', (s) => s.listAllTransactions()],
  ['exportAll', (s) => s.exportAll()],
  ['importAll', (s) => s.importAll(snapshot)],
];

describe('ApiStore (production stub)', () => {
  it.each(calls)('%s rejects because there is no backend', async (_name, invoke) => {
    await expect(invoke(makeStore())).rejects.toThrow(/production stub/);
  });
});
