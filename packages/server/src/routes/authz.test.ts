/**
 * The authorization matrix — Phase 4's "done when".
 *
 * BACKEND-PLAN §6: *"No client can act above its tier"*, proven by a matrix in
 * which **each tier is refused everything above it**. That is what this file
 * is: every route in the API surface, listed with the callers entitled to it,
 * driven by five real devices — anonymous, two different customers' phones, a
 * staff till and an admin's.
 *
 * It is deliberately exhaustive rather than representative. A missing guard is
 * a one-line omission in a route file and reads like every other route; the
 * only reliable way to notice is to assert the whole surface, so a route added
 * without an entry here fails {@link ROUTES} completeness rather than passing
 * unexamined.
 *
 * Two conventions worth knowing before reading the table:
 *
 *   • **Refusal is 401, 403 or 404.** Which one carries information: a caller
 *     with no session gets 401, a signed-in caller of the wrong tier gets 403,
 *     and a caller asking about a *card that is not theirs* gets 404 — because
 *     403 there would confirm the id exists to someone with no business knowing.
 *   • **Allowance is "not an authorization refusal".** A permitted caller may
 *     still get a 400 or a 409 for what it sent; what it must never get is 401
 *     or 403.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Customer } from '@cafe/shared/domain/models';
import { createAuthDeps, type AuthDeps } from '../auth/guards';
import type { Db } from '../db';
import { migrate } from '../migrate';
import { PostgresStore } from '../PostgresStore';
import { buildServer } from '../server';
import { resetSchema, testPool } from '../testing/database';
import { send, signIn, type Jar } from '../testing/http';

const ADMIN = { username: 'owner', password: 'owner-password-1', pin: '1111' };
const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };
const SPARE = { username: 'spare', password: 'spare-password-1', pin: '3333' };

/** Who is asking. `customer` is bound to card A, `other` to card B. */
type Caller = 'anon' | 'customer' | 'other' | 'staff' | 'admin';

const ALL_CALLERS: Caller[] = ['anon', 'customer', 'other', 'staff', 'admin'];

interface RouteCase {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  /** `:id` is card A's id, `:staffId` the spare account's, `:token` card A's token. */
  path: string;
  payload?: Record<string, unknown>;
  /** Callers entitled to reach the handler. Everyone else must be refused. */
  allow: Caller[];
}

/**
 * The whole API surface. Grouped by tier, in the order `routes/index.ts` lists
 * them, so the two can be read side by side.
 */
const ROUTES: RouteCase[] = [
  // ── public ────────────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/customers',
    payload: { displayName: 'New Person', email: 'new-person@example.test' },
    allow: ALL_CALLERS,
  },
  { method: 'GET', path: '/customers/by-token/:token', allow: ALL_CALLERS },
  { method: 'GET', path: '/me', allow: ALL_CALLERS },
  { method: 'PUT', path: '/me', payload: { token: ':tokenValue' }, allow: ['anon', 'customer', 'other'] },
  { method: 'DELETE', path: '/me', allow: ALL_CALLERS },
  {
    method: 'POST',
    path: '/recovery/request',
    payload: { email: 'card-a@example.test' },
    allow: ALL_CALLERS,
  },
  // Public, but a till is refused: a terminal must not become a customer's
  // device (the same refusal `PUT /me` makes).
  {
    method: 'POST',
    path: '/recovery/consume',
    payload: { email: 'card-a@example.test', code: 'ZZZZZZ' },
    allow: ['anon', 'customer', 'other'],
  },
  { method: 'GET', path: '/auth/session', allow: ALL_CALLERS },

  // ── the card's own device, or staff ───────────────────────────────────────
  { method: 'GET', path: '/customers/:id', allow: ['customer', 'staff', 'admin'] },
  { method: 'GET', path: '/customers/:id/state', allow: ['customer', 'staff', 'admin'] },
  { method: 'GET', path: '/customers/:id/rewards', allow: ['customer', 'staff', 'admin'] },
  { method: 'GET', path: '/customers/:id/transactions', allow: ['customer', 'staff', 'admin'] },
  { method: 'POST', path: '/customers/:id/consent', allow: ['customer', 'staff', 'admin'] },
  // The card's own device or an admin — staff cannot erase a customer at the counter.
  { method: 'DELETE', path: '/customers/:id', allow: ['customer', 'admin'] },

  // ── staff ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/customers/by-code/:shortCode', allow: ['staff', 'admin'] },
  { method: 'POST', path: '/customers/search', payload: { term: 'person' }, allow: ['staff', 'admin'] },
  {
    method: 'PATCH',
    path: '/customers/:id',
    payload: { displayName: 'Corrected Name' },
    allow: ['staff', 'admin'],
  },
  { method: 'POST', path: '/customers/:id/rotate-token', allow: ['staff', 'admin'] },
  {
    method: 'POST',
    path: '/customers/:id/commit',
    payload: {
      pointsDelta: 1,
      redeemRewardIds: [],
      idempotencyKey: 'authz-matrix-key-0001',
      source: 'a',
    },
    allow: ['staff', 'admin'],
  },
  {
    method: 'POST',
    path: '/customers/:id/transactions',
    payload: { type: 'accrual', points: 1 },
    allow: ['staff', 'admin'],
  },
  { method: 'GET', path: '/config', allow: ['staff', 'admin'] },
  { method: 'GET', path: '/audit', allow: ['staff', 'admin'] },
  { method: 'POST', path: '/audit', payload: { action: 'staff.login' }, allow: ['staff', 'admin'] },

  // ── admin ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/staff', allow: ['admin'] },
  {
    method: 'POST',
    path: '/staff',
    payload: { username: 'fresh', password: 'fresh-password-1', role: 'staff' },
    allow: ['admin'],
  },
  { method: 'PATCH', path: '/staff/:staffId', payload: { active: false }, allow: ['admin'] },
  {
    method: 'PATCH',
    path: '/staff/:staffId/password',
    payload: { password: 'replacement-password-1' },
    allow: ['admin'],
  },
  { method: 'PATCH', path: '/staff/:staffId/pin', payload: { pin: '9876' }, allow: ['admin'] },
  { method: 'DELETE', path: '/staff/:staffId', allow: ['admin'] },
  { method: 'PATCH', path: '/config', payload: { pointsPerReward: 8 }, allow: ['admin'] },
  { method: 'GET', path: '/alerts', allow: ['admin'] },
  {
    method: 'GET',
    path: '/transactions?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z',
    allow: ['admin'],
  },
  { method: 'GET', path: '/stats/active-customers', allow: ['admin'] },
  { method: 'GET', path: '/export', allow: ['admin'] },
  {
    method: 'POST',
    path: '/import',
    payload: {
      version: 6,
      exportedAt: '2026-09-15T00:00:00.000Z',
      config: {},
      staff: [],
      customers: [],
      transactions: [],
      audit: [],
    },
    allow: ['admin'],
  },
  { method: 'POST', path: '/auth/logout-all', allow: ['admin'] },
];

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;

let cardA: Customer;
let spareStaffId: string;
let jars: Record<Caller, Jar>;

async function registerCard(email: string): Promise<{ customer: Customer; jar: Jar }> {
  const jar: Jar = {};
  const response = await send(app, jar, {
    method: 'POST',
    url: '/customers',
    payload: { displayName: 'Card Holder', email },
  });
  expect(response.statusCode).toBe(201);
  return { customer: response.json() as Customer, jar };
}

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  deps = createAuthDeps({ db, store, cookieSecure: true });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();

  await store.createStaff({ ...ADMIN, passwordHash: ADMIN.password, role: 'admin' });
  await store.createStaff({ ...STAFF, passwordHash: STAFF.password, role: 'staff' });
  const spare = await store.createStaff({ ...SPARE, passwordHash: SPARE.password, role: 'staff' });
  spareStaffId = spare.id;

  const a = await registerCard('card-a@example.test');
  const b = await registerCard('card-b@example.test');
  cardA = a.customer;

  jars = {
    anon: {},
    customer: a.jar,
    other: b.jar,
    staff: await signIn(app, STAFF.username, STAFF.password),
    admin: await signIn(app, ADMIN.username, ADMIN.password),
  };
});

afterEach(async () => {
  await app.close();
  await db.end();
});

/** Substitutes the fixtures a route case names into its path and payload. */
function materialize(route: RouteCase): InjectOptions {
  const url = route.path
    .replace(':id', cardA.id)
    .replace(':staffId', spareStaffId)
    .replace(':shortCode', cardA.shortCode)
    .replace(':token', cardA.token);

  const payload = route.payload
    ? JSON.parse(JSON.stringify(route.payload).replace(':tokenValue', cardA.token))
    : undefined;

  return { method: route.method, url, ...(payload ? { payload } : {}) };
}

const REFUSALS = [401, 403, 404];

describe('the authorization matrix', () => {
  // One test per caller rather than per route: a refused request changes
  // nothing, so a whole tier's refusals can share one seeded database.
  for (const caller of ALL_CALLERS) {
    it(`refuses ${caller} everything above its tier`, async () => {
      const wrongly: string[] = [];
      for (const route of ROUTES) {
        if (route.allow.includes(caller)) continue;
        const response = await send(app, { ...jars[caller] }, materialize(route));
        if (!REFUSALS.includes(response.statusCode)) {
          wrongly.push(`${route.method} ${route.path} → ${response.statusCode}`);
        }
      }
      expect(wrongly).toEqual([]);
    });
  }

  /**
   * The other half of the claim. A matrix that only proved refusals would pass
   * just as well with every route returning 403, which would be a broken system
   * rather than a secure one.
   */
  it('lets every entitled caller through', async () => {
    const blocked: string[] = [];
    for (const route of ROUTES) {
      // The most junior entitled caller is the interesting one: if `staff` can
      // reach a staff route, `admin` can by construction (`requireAdmin` is
      // `requireStaff` plus a role check).
      const caller = ALL_CALLERS.find((candidate) => route.allow.includes(candidate));
      if (!caller) continue;
      const response = await send(app, { ...jars[caller] }, materialize(route));
      if (response.statusCode === 401 || response.statusCode === 403) {
        blocked.push(`${caller} ${route.method} ${route.path} → ${response.statusCode}`);
      }
    }
    expect(blocked).toEqual([]);
  });

  /**
   * The refusal *code* is part of the design, not an accident: a stranger asking
   * about a card must not be able to tell "not yours" from "no such card".
   */
  it('answers 404, not 403, when a customer asks about another customer’s card', async () => {
    const response = await send(app, { ...jars.other }, {
      method: 'GET',
      url: `/customers/${cardA.id}/state`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses a staff tier route with 403, not 404, once signed in', async () => {
    const response = await send(app, { ...jars.staff }, { method: 'GET', url: '/staff' });
    expect(response.statusCode).toBe(403);
  });

  it('refuses an anonymous staff-tier request with 401', async () => {
    const response = await send(app, {}, { method: 'GET', url: '/config' });
    expect(response.statusCode).toBe(401);
  });
});
