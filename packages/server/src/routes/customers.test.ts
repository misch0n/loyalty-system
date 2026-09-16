/**
 * Customer routes, end to end against a real database.
 *
 * The assertions that matter here are the ones that would still pass if the
 * route simply forwarded the request body to the store — and must not. Each of
 * BACKEND-PLAN §4's contract problems gets a test that fails if the fix is
 * removed: the body's `staffId` is ignored, the body's token is ignored, the
 * audit row is the server's, a replayed commit writes nothing twice, and a
 * reversal's points are derived rather than accepted.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuditLogEntry, Customer, LoyaltyTransaction } from '@cafe/shared/domain/models';
import type { CommitResult } from '@cafe/shared/ports/DataStore';
import { createAuthDeps, SESSION_COOKIE, type AuthDeps } from '../auth/guards';
import type { Db } from '../db';
import { migrate } from '../migrate';
import { PostgresStore } from '../PostgresStore';
import { buildServer } from '../server';
import { resetSchema, testPool } from '../testing/database';
import { send, signIn, type Jar } from '../testing/http';
import { CollectingMailer } from '../testing/mail';

const ADMIN = { username: 'owner', password: 'owner-password-1', pin: '1111' };
const STAFF = { username: 'barista', password: 'barista-password-1', pin: '2222' };
const OTHER_STAFF = { username: 'colleague', password: 'colleague-password-1', pin: '3333' };

let db: Db;
let store: PostgresStore;
let deps: AuthDeps;
let app: FastifyInstance;
let staffId: string;
let otherStaffId: string;
let adminId: string;
let mailer: CollectingMailer;

beforeEach(async () => {
  db = testPool();
  await resetSchema(db);
  await migrate(db);
  store = new PostgresStore(db);
  mailer = new CollectingMailer();
  deps = createAuthDeps({
    db,
    store,
    cookieSecure: true,
    mailer,
    appUrl: 'https://cafe.example',
  });
  app = buildServer({ logLevel: 'silent', auth: deps });
  await app.ready();

  adminId = (await store.createStaff({ ...ADMIN, passwordHash: ADMIN.password, role: 'admin' })).id;
  staffId = (await store.createStaff({ ...STAFF, passwordHash: STAFF.password, role: 'staff' })).id;
  otherStaffId = (
    await store.createStaff({ ...OTHER_STAFF, passwordHash: OTHER_STAFF.password, role: 'staff' })
  ).id;
});

afterEach(async () => {
  // Transactional mail is background work; drain it before the pool closes.
  await deps.background.drain();
  await app.close();
  await db.end();
});

async function register(
  email = 'holder@example.test',
  over: Record<string, unknown> = {},
): Promise<{ status: number; body: Customer; jar: Jar }> {
  const jar: Jar = {};
  const response = await send(app, jar, {
    method: 'POST',
    url: '/customers',
    payload: { displayName: 'Card Holder', email, ...over },
  });
  return { status: response.statusCode, body: response.json() as Customer, jar };
}

async function staffJar(): Promise<Jar> {
  return signIn(app, STAFF.username, STAFF.password);
}

async function auditRows(action?: AuditLogEntry['action']): Promise<AuditLogEntry[]> {
  return store.listAudit(action ? { action } : {});
}

// ── registration ──────────────────────────────────────────────────────────────

describe('POST /customers', () => {
  it('creates a card and binds it to this device', async () => {
    const { status, body, jar } = await register();
    expect(status).toBe(201);
    expect(body.displayName).toBe('Card Holder');
    expect(body.email).toBe('holder@example.test');
    expect(jar[SESSION_COOKIE]).toBeTruthy();

    const me = await send(app, jar, { method: 'GET', url: '/me' });
    expect(me.json()).toEqual({ token: body.token });
  });

  it('requires a name and an email (SCOPE-DECISIONS §2.1)', async () => {
    for (const payload of [
      { email: 'no-name@example.test' },
      { displayName: 'No Email' },
      { displayName: 'Bad Email', email: 'not-an-address' },
    ]) {
      const response = await send(app, {}, { method: 'POST', url: '/customers', payload });
      expect(response.statusCode).toBe(400);
    }
  });

  it('ignores a client-supplied token and issues its own (§3-B-10)', async () => {
    // A caller that could choose its own token could choose one it had seen.
    const chosen = 'AAAAAAAAAAAAAAAAAAAAAA';
    const { body } = await register('chooser@example.test', { token: chosen });
    expect(body.token).not.toBe(chosen);
    expect(await store.getCustomerByToken(chosen)).toBeNull();
  });

  it('dates consent from the server, not the request', async () => {
    const { body } = await register('backdater@example.test', {
      consentAt: '1999-01-01T00:00:00.000Z',
    });
    expect(body.consentAt?.startsWith('1999')).toBe(false);
  });

  it('offers recovery rather than a second card for an address in use (§3.4)', async () => {
    await register('duplicate@example.test');
    const response = await send(app, {}, {
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Impostor', email: 'duplicate@example.test' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'email_in_use' });
  });

  it('locks out a source address that keeps failing', async () => {
    await register('taken@example.test');
    const attempt = () =>
      send(app, {}, {
        method: 'POST',
        url: '/customers',
        payload: { displayName: 'Prober', email: 'taken@example.test' },
      });

    // Five failures inside the window; the sixth is refused before it is tried,
    // which is what stops an address list being walked for `email_in_use`.
    for (let i = 0; i < 5; i += 1) expect((await attempt()).statusCode).toBe(409);
    expect((await attempt()).statusCode).toBe(429);
  });

  it('writes the registration trail itself, as `system`', async () => {
    const { body } = await register();
    const rows = await auditRows();
    const actions = rows.map((row) => row.action);
    expect(actions).toContain('card.issue');
    expect(actions).toContain('customer.register');
    for (const row of rows) {
      expect(row.actorRole).toBe('system');
      expect(row.targetId).toBe(body.id);
    }
  });

  it('does not turn a till into the customer’s device', async () => {
    const jar = await staffJar();
    const before = jar[SESSION_COOKIE];
    const response = await send(app, jar, {
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Counter Signup', email: 'counter@example.test' },
    });
    expect(response.statusCode).toBe(201);
    expect(jar[SESSION_COOKIE]).toBe(before);

    const session = await send(app, jar, { method: 'GET', url: '/auth/session' });
    expect((session.json() as { status: string }).status).toBe('active');
  });
});

// ── reads ─────────────────────────────────────────────────────────────────────

describe('GET /customers/by-token/:token', () => {
  it('resolves a card and binds an unrecognised device to it', async () => {
    const { body } = await register();
    const fresh: Jar = {};
    const response = await send(app, fresh, {
      method: 'GET',
      url: `/customers/by-token/${body.token}`,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as Customer).id).toBe(body.id);

    const me = await send(app, fresh, { method: 'GET', url: '/me' });
    expect(me.json()).toEqual({ token: body.token });
  });

  it('leaves a till unbound', async () => {
    const { body } = await register();
    const jar = await staffJar();
    await send(app, jar, { method: 'GET', url: `/customers/by-token/${body.token}` });
    const me = await send(app, jar, { method: 'GET', url: '/me' });
    expect(me.json()).toEqual({ token: null });
  });

  it('answers 404 for an unknown or malformed token', async () => {
    for (const token of ['AAAAAAAAAAAAAAAAAAAAAA', 'nope']) {
      const response = await send(app, {}, { method: 'GET', url: `/customers/by-token/${token}` });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe('POST /customers/search', () => {
  it('takes the term in the body so it never reaches a log or a URL (§3-B-11)', async () => {
    await register('searchable@example.test');
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'POST',
      url: '/customers/search',
      payload: { term: 'searchable@example.test' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as Customer[])).toHaveLength(1);
  });

  it('has no GET form carrying the term in a query string', async () => {
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'GET',
      url: '/customers?term=searchable%40example.test',
    });
    expect(response.statusCode).toBe(404);
  });
});

// ── the commit ────────────────────────────────────────────────────────────────

describe('POST /customers/:id/commit', () => {
  const key = () => `commit-key-${Math.random().toString(36).slice(2)}`;

  it('attributes the commit to the session, never to the body (§4-D)', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      // A till claiming to be a colleague — the single most useful lie a
      // compromised client could tell, and the one the ledger must not record.
      payload: {
        pointsDelta: 1,
        redeemRewardIds: [],
        idempotencyKey: key(),
        source: 'a',
        staffId: otherStaffId,
      },
    });
    expect(response.statusCode).toBe(200);

    const ledger = await store.listTransactions(customer.id);
    expect(ledger.map((entry) => entry.staffId)).toEqual([staffId]);
    const accrue = await auditRows('loyalty.accrue');
    expect(accrue.map((row) => row.actorId)).toEqual([staffId]);
  });

  it('writes the accrual audit row itself (§4-C)', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload: { pointsDelta: 3, redeemRewardIds: [], idempotencyKey: key(), source: 'w' },
    });
    const rows = await auditRows('loyalty.accrue');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toBe('+3 w');
    expect(rows[0]?.targetId).toBe(customer.id);
  });

  it('writes one redeem row per reward actually spent', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    // Threshold is 9 and the per-scan cap is 3, so three full scans mint
    // exactly one reward — the ordinary way a card fills up.
    for (let i = 0; i < 3; i += 1) {
      await send(app, jar, {
        method: 'POST',
        url: `/customers/${customer.id}/commit`,
        payload: { pointsDelta: 3, redeemRewardIds: [], idempotencyKey: key(), source: 'a' },
      });
    }
    const minted = await store.listRewards(customer.id, 'unspent');
    expect(minted).toHaveLength(1);

    const spend = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload: {
        pointsDelta: 0,
        redeemRewardIds: [minted[0]?.id],
        idempotencyKey: key(),
        source: 'a',
      },
    });
    const result = spend.json() as CommitResult;
    expect(result.ok && result.redeemed).toHaveLength(1);
    expect(await auditRows('loyalty.redeem')).toHaveLength(1);
  });

  it('writes no second audit row when a commit is replayed', async () => {
    // The ledger is protected by the idempotency key; without the replay check
    // the audit log would not be, and one accrual would read as two — inflating
    // exactly the data the self-dealing detector pairs.
    const { body: customer } = await register();
    const jar = await staffJar();
    const idempotencyKey = key();
    const payload = { pointsDelta: 2, redeemRewardIds: [], idempotencyKey, source: 'a' };

    const first = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload,
    });
    const second = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload,
    });

    expect(first.json()).toEqual(second.json());
    expect(await store.listTransactions(customer.id)).toHaveLength(1);
    expect(await auditRows('loyalty.accrue')).toHaveLength(1);
  });

  it('answers 404 for a card that is not there, and counts the failure', async () => {
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'POST',
      url: '/customers/00000000-0000-0000-0000-000000000000/commit',
      payload: { pointsDelta: 1, redeemRewardIds: [], idempotencyKey: key(), source: 'a' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ ok: false, error: 'customer_not_found' });
  });

  it('refuses more points than the per-scan cap', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload: { pointsDelta: 999, redeemRewardIds: [], idempotencyKey: key(), source: 'a' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ ok: false, error: 'over_cap' });
    expect(await store.listTransactions(customer.id)).toEqual([]);
  });
});

// ── corrections ───────────────────────────────────────────────────────────────

describe('POST /customers/:id/transactions', () => {
  async function accrue(jar: Jar, customerId: string, points: number) {
    const response = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customerId}/transactions`,
      payload: { type: 'accrual', points },
    });
    return response.json() as LoyaltyTransaction;
  }

  it('clamps an accrual to the per-transaction cap', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    const config = await store.getConfig();
    // Inside what the route schema will parse, far outside what the program
    // allows — so the clamp is what refuses it, not the boundary validator.
    const tx = await accrue(jar, customer.id, 500);
    expect(tx.points).toBe(config.maxPointsPerTransaction);
  });

  it('derives a reversal’s points from the original, never from the body', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    const original = await accrue(jar, customer.id, 3);

    const response = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/transactions`,
      // A reversal that credits instead of debiting would be free points.
      payload: { type: 'reversal', points: 500, reversesTransactionId: original.id },
    });
    expect((response.json() as LoyaltyTransaction).points).toBe(-3);
  });

  it('refuses to reverse the same entry twice', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    const original = await accrue(jar, customer.id, 2);
    const reverse = () =>
      send(app, jar, {
        method: 'POST',
        url: `/customers/${customer.id}/transactions`,
        payload: { type: 'reversal', reversesTransactionId: original.id },
      });
    expect((await reverse()).statusCode).toBe(200);
    expect((await reverse()).statusCode).toBe(409);
  });

  it('refuses to reverse a reversal, or an entry from another card', async () => {
    const { body: customer } = await register();
    const { body: other } = await register('other@example.test');
    const jar = await staffJar();
    const original = await accrue(jar, customer.id, 2);

    const reversal = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/transactions`,
      payload: { type: 'reversal', reversesTransactionId: original.id },
    });
    const reversalId = (reversal.json() as LoyaltyTransaction).id;

    const again = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/transactions`,
      payload: { type: 'reversal', reversesTransactionId: reversalId },
    });
    expect(again.statusCode).toBe(400);

    const crossCard = await send(app, jar, {
      method: 'POST',
      url: `/customers/${other.id}/transactions`,
      payload: { type: 'reversal', reversesTransactionId: original.id },
    });
    expect(crossCard.statusCode).toBe(404);
  });

  it('refuses a ledger type a client may not append', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    for (const type of ['reward_issue', 'redemption']) {
      const response = await send(app, jar, {
        method: 'POST',
        url: `/customers/${customer.id}/transactions`,
        payload: { type, points: 1 },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('PATCH /customers/:id', () => {
  it('audits the fields changed and never their values', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'PATCH',
      url: `/customers/${customer.id}`,
      payload: { displayName: 'Corrected', email: 'corrected@example.test' },
    });
    expect(response.statusCode).toBe(200);

    const rows = await auditRows('customer.correct');
    expect(rows[0]?.details).toBe('displayName,email');
    expect(rows[0]?.details).not.toContain('corrected@example.test');
  });

  it('refuses an address another active card already holds', async () => {
    const { body: customer } = await register();
    await register('taken@example.test');
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'PATCH',
      url: `/customers/${customer.id}`,
      payload: { email: 'taken@example.test' },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('POST /customers/:id/rotate-token', () => {
  it('issues the new token server-side and invalidates the old QR', async () => {
    const { body: customer } = await register();
    const jar = await staffJar();
    const response = await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/rotate-token`,
    });
    const rotated = response.json() as Customer;
    expect(rotated.token).not.toBe(customer.token);
    expect(await store.getCustomerByToken(customer.token)).toBeNull();
    expect((await auditRows('card.reissue'))[0]?.actorId).toBe(staffId);
  });
});

// ── deletion ──────────────────────────────────────────────────────────────────

describe('DELETE /customers/:id', () => {
  it('tombstones the card, frees the address and drops the recognition', async () => {
    const { body: customer, jar } = await register('deleter@example.test');
    const response = await send(app, jar, { method: 'DELETE', url: `/customers/${customer.id}` });
    expect(response.statusCode).toBe(204);

    const row = await store.getCustomerById(customer.id);
    expect(row?.status).toBe('deleted');
    expect(row?.email).toBeUndefined();
    expect(row?.token).toBe('');
    expect(await store.getCustomerByToken(customer.token)).toBeNull();

    // The cookie went with the card.
    const me = await send(app, jar, { method: 'GET', url: '/me' });
    expect(me.json()).toEqual({ token: null });

    // …and the address is free for a fresh card starting at zero (Q3).
    const again = await register('deleter@example.test');
    expect(again.status).toBe(201);
  });

  it('is an admin operation, not a counter one', async () => {
    const { body: customer } = await register();
    const staff = await staffJar();
    expect(
      (await send(app, staff, { method: 'DELETE', url: `/customers/${customer.id}` })).statusCode,
    ).toBe(404);

    const admin = await signIn(app, ADMIN.username, ADMIN.password);
    const response = await send(app, admin, { method: 'DELETE', url: `/customers/${customer.id}` });
    expect(response.statusCode).toBe(204);
    expect((await auditRows('customer.delete'))[0]?.actorId).toBe(adminId);
  });
});

// ── transactional mail ────────────────────────────────────────────────────────

/**
 * Phase 5 moved the welcome and reward-available mails from the browser to the
 * routes, so that a server-backed build has exactly **one** sender. The tests
 * are about where the send sits, not about the wording: it must not block the
 * request it belongs to, and a replayed commit must not mail twice.
 */
describe('transactional mail', () => {
  const key = () => `mail-key-${Math.random().toString(36).slice(2)}`;

  it('welcomes a new card with a link to it', async () => {
    const { body: customer } = await register('welcome@example.test');
    await deps.background.drain();

    const mail = mailer.last('card-created');
    expect(mail?.to).toBe('welcome@example.test');
    expect(mail?.params.card_link).toBe(`https://cafe.example/#/card/${customer.token}`);
  });

  it('answers the registration before the mail is sent', async () => {
    // Best-effort, exactly as `CustomerService.sendWelcome` is: a slow or broken
    // mail server must never be what fails a registration. The hold is a stalled
    // provider — the registration has to come back regardless.
    const release = mailer.hold();
    const { status } = await register('async@example.test');
    expect(status).toBe(201);
    expect(mailer.outbox).toHaveLength(0);

    release();
    await deps.background.drain();
    expect(mailer.outbox).toHaveLength(1);
  });

  it('still registers the card when the mail fails', async () => {
    mailer.failWith = new Error('smtp is down');
    const { status, body } = await register('failing@example.test');
    await deps.background.drain();

    expect(status).toBe(201);
    expect(await store.getCustomerById(body.id)).not.toBeNull();
  });

  it('mails once when a commit mints a reward, and not before', async () => {
    const { body: customer } = await register('rewarded@example.test');
    const jar = await staffJar();
    // Threshold is 9 and the per-scan cap is 3, so the reward is crossed on the
    // third commit — not the first two.
    for (let i = 0; i < 3; i += 1) {
      await send(app, jar, {
        method: 'POST',
        url: `/customers/${customer.id}/commit`,
        payload: { pointsDelta: 3, redeemRewardIds: [], idempotencyKey: key(), source: 'a' },
      });
      await deps.background.drain();
      expect(mailer.outbox.filter((mail) => mail.kind === 'reward-available')).toHaveLength(
        i === 2 ? 1 : 0,
      );
    }

    const mail = mailer.last('reward-available');
    expect(mail?.to).toBe('rewarded@example.test');
    expect(mail?.params.reward).toBe('Free regular coffee');
  });

  it('sends no second mail when a commit is replayed', async () => {
    // Same reason a replay writes no second audit row: the customer already had
    // this mail, and a retry after a timeout must be invisible to them.
    const { body: customer } = await register('replay@example.test');
    const jar = await staffJar();
    const idempotencyKey = key();
    for (let i = 0; i < 2; i += 1) {
      await send(app, jar, {
        method: 'POST',
        url: `/customers/${customer.id}/commit`,
        payload: { pointsDelta: 3, redeemRewardIds: [], idempotencyKey: key(), source: 'a' },
      });
    }
    for (let i = 0; i < 2; i += 1) {
      await send(app, jar, {
        method: 'POST',
        url: `/customers/${customer.id}/commit`,
        payload: { pointsDelta: 3, redeemRewardIds: [], idempotencyKey, source: 'a' },
      });
    }
    await deps.background.drain();

    expect(mailer.outbox.filter((mail) => mail.kind === 'reward-available')).toHaveLength(1);
  });

  it('sends nothing on a commit that mints nothing', async () => {
    const { body: customer } = await register('quiet@example.test');
    const jar = await staffJar();
    await send(app, jar, {
      method: 'POST',
      url: `/customers/${customer.id}/commit`,
      payload: { pointsDelta: 1, redeemRewardIds: [], idempotencyKey: key(), source: 'a' },
    });
    await deps.background.drain();

    expect(mailer.outbox.filter((mail) => mail.kind === 'reward-available')).toEqual([]);
  });
});
