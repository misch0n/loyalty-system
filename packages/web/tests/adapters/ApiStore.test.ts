/**
 * `ApiStore` — which route each `DataStore` method calls, and what it sends.
 *
 * The routes were read off `packages/server/src/routes/` when this was written
 * (UI-1). `fetch` is a double, so this pins the *mapping*; whether the server
 * still answers it is proven against a real server by the UI-2 harness (P6).
 * What each method deliberately does **not** send — a client-chosen token, a
 * `staffId`, an actor filter — is pinned too, since sending it would suggest
 * the server honours it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/adapters/http/ApiClient';
import { ApiError } from '../../src/adapters/http/ApiError';
import { ApiStore } from '../../src/adapters/storage/ApiStore';
import type { DataStore } from '@cafe/shared/ports/DataStore';
import type { Snapshot } from '@cafe/shared/domain/models';

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
  rewards: [],
  rewardEvents: [],
  audit: [],
} as unknown as Snapshot;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let store: DataStore;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(json(200, {}));
  store = new ApiStore(new ApiClient({ baseUrl: '/api', fetch: fetchMock, readCsrfToken: () => 't' }));
});

function lastCall(): { method: string; url: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return {
    method: init.method as string,
    url,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

type Row = [
  name: string,
  invoke: (s: DataStore) => Promise<unknown>,
  method: string,
  url: string,
  body?: unknown,
];

const routes: Row[] = [
  [
    'createCustomer',
    (s) => s.createCustomer({ token: 'client-token', displayName: 'Ana', email: 'a@b.c', consentAt: 'x' }),
    'POST',
    '/api/customers',
    { displayName: 'Ana', email: 'a@b.c' },
  ],
  ['getCustomerById', (s) => s.getCustomerById('c 1'), 'GET', '/api/customers/c%201'],
  ['getCustomerByToken', (s) => s.getCustomerByToken('tok'), 'GET', '/api/customers/by-token/tok'],
  ['getCustomerByShortCode', (s) => s.getCustomerByShortCode('AB-12'), 'GET', '/api/customers/by-code/AB-12'],
  ['findCustomers', (s) => s.findCustomers({ term: 'ana@x' }), 'POST', '/api/customers/search', { term: 'ana@x' }],
  ['updateCustomer', (s) => s.updateCustomer('c1', { displayName: 'B' }), 'PATCH', '/api/customers/c1', { displayName: 'B' }],
  ['recordConsent', (s) => s.recordConsent('c1', '2026-01-01'), 'POST', '/api/customers/c1/consent'],
  ['rotateToken', (s) => s.rotateToken('c1', 'client-token'), 'POST', '/api/customers/c1/rotate-token'],
  ['softDeleteCustomer', (s) => s.softDeleteCustomer('c1'), 'DELETE', '/api/customers/c1'],
  [
    'appendTransaction',
    (s) =>
      s.appendTransaction({ customerId: 'c1', type: 'reversal', points: -1, staffId: 'spoofed', reversesTransactionId: 't9' }),
    'POST',
    '/api/customers/c1/transactions',
    { type: 'reversal', points: -1, reversesTransactionId: 't9' },
  ],
  ['listTransactions', (s) => s.listTransactions('c1'), 'GET', '/api/customers/c1/transactions'],
  [
    'commitCounterTransaction',
    (s) =>
      s.commitCounterTransaction({
        customerId: 'c1',
        pointsDelta: 2,
        redeemRewardIds: ['r1'],
        staffId: 'spoofed',
        idempotencyKey: 'key-12345',
        source: 'a',
      }),
    'POST',
    '/api/customers/c1/commit',
    { pointsDelta: 2, redeemRewardIds: ['r1'], idempotencyKey: 'key-12345', source: 'a' },
  ],
  ['listRewards', (s) => s.listRewards('c1'), 'GET', '/api/customers/c1/rewards'],
  ['listRewards (status)', (s) => s.listRewards('c1', 'unspent'), 'GET', '/api/customers/c1/rewards?status=unspent'],
  ['getCustomerState', (s) => s.getCustomerState('c1'), 'GET', '/api/customers/c1/state'],
  [
    'createStaff',
    (s) => s.createStaff({ username: 'u', password: 'p', role: 'staff', name: 'U' }),
    'POST',
    '/api/staff',
    { username: 'u', password: 'p', role: 'staff', name: 'U' },
  ],
  ['setStaffActive', (s) => s.setStaffActive('s1', false), 'PATCH', '/api/staff/s1', { active: false }],
  ['setStaffPassword', (s) => s.setStaffPassword('s1', 'pw'), 'PATCH', '/api/staff/s1/password', { password: 'pw' }],
  ['deleteStaff', (s) => s.deleteStaff('s1'), 'DELETE', '/api/staff/s1'],
  ['listStaff', (s) => s.listStaff(), 'GET', '/api/staff'],
  ['getConfig', (s) => s.getConfig(), 'GET', '/api/config'],
  ['updateConfig', (s) => s.updateConfig({ pointsPerReward: 8 }), 'PATCH', '/api/config', { pointsPerReward: 8 }],
  ['listAudit (no filter)', (s) => s.listAudit(), 'GET', '/api/audit'],
  [
    'listAudit (actor filter dropped)',
    (s) =>
      s.listAudit({ actions: ['loyalty.accrue', 'loyalty.redeem'], actorId: 'x', actorIds: ['y'], from: 'f', limit: 10 }),
    'GET',
    '/api/audit?actions=loyalty.accrue%2Cloyalty.redeem&from=f&limit=10',
  ],
  ['countActiveCustomers', (s) => s.countActiveCustomers(), 'GET', '/api/stats/active-customers'],
  ['exportAll', (s) => s.exportAll(), 'GET', '/api/export'],
  ['importAll', (s) => s.importAll(snapshot), 'POST', '/api/import', snapshot],
];

describe('ApiStore routes', () => {
  it.each(routes)('%s → %s %s', async (_name, invoke, method, url, body) => {
    await invoke(store);
    const call = lastCall();
    expect(call.method).toBe(method);
    expect(call.url).toBe(url);
    expect(call.body).toEqual(body);
  });
});

describe('ApiStore — absence is a value', () => {
  it.each<[string, (s: DataStore) => Promise<unknown>]>([
    ['getCustomerById', (s) => s.getCustomerById('c1')],
    ['getCustomerByToken', (s) => s.getCustomerByToken('t')],
    ['getCustomerByShortCode', (s) => s.getCustomerByShortCode('AB')],
  ])('%s resolves null on a 404', async (_name, invoke) => {
    fetchMock.mockResolvedValueOnce(json(404, { error: 'not_found' }));
    await expect(invoke(store)).resolves.toBeNull();
  });

  it('a lookup still throws when the failure is not absence', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));
    await expect(store.getCustomerByShortCode('AB')).rejects.toBeInstanceOf(ApiError);
  });

  it('a non-lookup 404 throws', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: 'not_found' }));
    await expect(store.updateCustomer('c1', { displayName: 'x' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('ApiStore — the commit’s refusals are CommitResult values', () => {
  const txn = {
    customerId: 'c1',
    pointsDelta: 9,
    redeemRewardIds: [],
    staffId: 's',
    idempotencyKey: 'key-12345',
    source: 'a' as const,
  };

  it('over_cap (400) resolves { ok: false }', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { ok: false, error: 'over_cap' }));
    await expect(store.commitCounterTransaction(txn)).resolves.toEqual({ ok: false, error: 'over_cap' });
  });

  it('customer_not_found (404) resolves { ok: false }', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { ok: false, error: 'customer_not_found' }));
    await expect(store.commitCounterTransaction(txn)).resolves.toEqual({
      ok: false,
      error: 'customer_not_found',
    });
  });

  it('a schema refusal is still an error', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_request' }));
    await expect(store.commitCounterTransaction(txn)).rejects.toBeInstanceOf(ApiError);
  });

  it('a rate limit is still an error', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: 'rate_limited', retryAfterSec: 5 }));
    await expect(store.commitCounterTransaction(txn)).rejects.toMatchObject({
      failure: { kind: 'rate_limited', retryAfterSec: 5 },
    });
  });
});

describe('ApiStore — holds no trusted capability', () => {
  it('has none of TrustedStore’s methods, so a client cannot even express them', () => {
    // Audit writes, the recovery-code trio, the digest-bearing username lookup and
    // the unbounded ledger read (P9) are the server's alone.
    for (const method of [
      'appendAudit',
      'createRecoveryCode',
      'consumeRecoveryCode',
      'recordFailedRecoveryAttempt',
      'getStaffByUsername',
      'listAllTransactions',
    ]) {
      expect(method in store).toBe(false);
    }
  });
});
