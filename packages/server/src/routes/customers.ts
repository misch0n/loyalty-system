/**
 * Customer routes — registration, card reads, corrections, and the commit.
 *
 * This is where BACKEND-PLAN §4's contract problems stop being notes and become
 * code. A `DataStore` method is a trusted in-process call in the prototype; here
 * the same method is an untrusted HTTP request, so each one is re-stated with
 * the trust it actually has:
 *
 *   • **§4-D — the actor is the session's.** `CounterTransaction.staffId` and
 *     `AppendTransactionInput.staffId` arrive in the body and are *discarded*.
 *     A customer's device holds a customer session and therefore cannot commit
 *     points at all, whatever JSON it sends. This is `CLAUDE.md`'s "staff
 *     initiates the credit" made structural.
 *   • **§4-C — the server writes the audit rows.** Every route that changes
 *     something appends its own audit entry from the session actor. A
 *     client-supplied actor and action is not an audit log.
 *   • **§3-B-10 — the server generates the token.** `CreateCustomerInput.token`
 *     is ignored on registration. A caller that picks its own token could pick
 *     one it has seen elsewhere, or a low-entropy one; identity has to be the
 *     server's to issue.
 *   • **§3-B-11 — PII stays out of URLs.** The prototype's
 *     `GET /customers?term=…` puts an email in a query string, which lands in
 *     every access log and proxy on the way. It is `POST /customers/search`
 *     here; Phase 6 points the adapter at it.
 *
 * Reads that name a customer by id are allowed to staff **or** to the device
 * that card is bound to — a customer must be able to read their own card, and
 * nobody else's.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  Customer,
  LoyaltyTransaction,
  ProgramConfig,
  RewardStatus,
} from '@cafe/shared/domain/models';
import type { CommitResult } from '@cafe/shared/ports/DataStore';
import type { OutboundMail } from '@cafe/shared/ports/Mailer';
import { generateToken, isValidToken, normalizeShortCode } from '@cafe/shared/domain/tokens';
import { isValidEmail } from '@cafe/shared/domain/validation';
import type { AuthDeps } from '../auth/guards';
import { cookieMaxAgeSec, requireStaff, setSessionCookies } from '../auth/guards';
import { cardLink } from '../mail/links';
import {
  isActiveStaff,
  isCommitReplay,
  notFound,
  refuse,
  requireActor,
  sessionCustomerId,
} from './shared';

// ── schemas ───────────────────────────────────────────────────────────────────

/**
 * SCOPE-DECISIONS §2.1: name and email are **required**, which deletes the
 * prototype's token-only account. `domain/validation.ts` still describes all PII
 * as optional — it is a shared file Phase 11 reconciles — so the requirement is
 * stated here, where the database's `customers_active_fields_present` CHECK
 * backs it up.
 */
const REGISTER_SCHEMA = {
  body: {
    type: 'object',
    required: ['displayName', 'email'],
    additionalProperties: false,
    properties: {
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      email: { type: 'string', minLength: 3, maxLength: 254 },
      phone: { type: 'string', maxLength: 32 },
      // Accepted and ignored: identity is the server's to issue (§3-B-10). It is
      // listed so an old client sending one gets a card rather than a 400.
      token: { type: 'string', maxLength: 64 },
      consentAt: { type: 'string', maxLength: 40 },
    },
  },
};

const SEARCH_SCHEMA = {
  body: {
    type: 'object',
    required: ['term'],
    additionalProperties: false,
    properties: { term: { type: 'string', minLength: 1, maxLength: 120 } },
  },
};

const PATCH_SCHEMA = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      email: { type: 'string', minLength: 3, maxLength: 254 },
      phone: { type: 'string', maxLength: 32 },
    },
  },
};

const COMMIT_SCHEMA = {
  body: {
    type: 'object',
    required: ['pointsDelta', 'redeemRewardIds', 'idempotencyKey', 'source'],
    // NOT `additionalProperties: false`: the client sends the whole
    // `CounterTransaction`, `staffId` included. Rejecting the field would make
    // the adapter strip it; ignoring it makes the override unmissable instead.
    properties: {
      customerId: { type: 'string', maxLength: 64 },
      pointsDelta: { type: 'integer', minimum: 0, maximum: 1000 },
      redeemRewardIds: {
        type: 'array',
        maxItems: 15,
        items: { type: 'string', maxLength: 64 },
      },
      idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
      source: { type: 'string', enum: ['a', 'w'] },
      staffId: { type: 'string', maxLength: 64 },
    },
  },
};

const APPEND_TRANSACTION_SCHEMA = {
  body: {
    type: 'object',
    required: ['type'],
    properties: {
      customerId: { type: 'string', maxLength: 64 },
      // `reward_issue` is minted by the commit and `redemption` is retired —
      // neither is a thing a client may append.
      type: { type: 'string', enum: ['accrual', 'reversal'] },
      points: { type: 'integer', minimum: -1000, maximum: 1000 },
      staffId: { type: 'string', maxLength: 64 },
      note: { type: 'string', maxLength: 200 },
      reversesTransactionId: { type: 'string', maxLength: 64 },
    },
  },
};

interface IdParams {
  id: string;
}

interface RegisterBody {
  displayName: string;
  email: string;
  phone?: string;
  consentAt?: string;
}

interface CommitBody {
  pointsDelta: number;
  redeemRewardIds: string[];
  idempotencyKey: string;
  source: 'a' | 'w';
}

interface AppendBody {
  type: 'accrual' | 'reversal';
  points?: number;
  note?: string;
  reversesTransactionId?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const EMAIL_IN_USE = 'customers_email_active_key';

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e?.constraint === constraint;
}

/**
 * A card read the caller is entitled to: any active staff member, or the device
 * this card is bound to. Returns the customer, or sends the refusal and returns
 * `null` — a caller that may not read this card is told 404, not 403, so the
 * route is not an id-existence oracle for a stranger.
 */
async function readableCustomer(
  request: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
  deps: AuthDeps,
): Promise<Customer | null> {
  const id = request.params.id;
  if (!isActiveStaff(request) && sessionCustomerId(request) !== id) {
    notFound(reply);
    return null;
  }
  const customer = await deps.store.getCustomerById(id);
  if (!customer) {
    notFound(reply);
    return null;
  }
  return customer;
}

/** Points a single accrual may grant, clamped server-side as the client does. */
function clampAccrual(points: number, config: ProgramConfig): number {
  const cap = Math.max(1, config.maxPointsPerTransaction);
  return Math.max(0, Math.min(cap, Math.floor(points)));
}

/**
 * Sends a transactional mail without making the request wait for it.
 *
 * **The server is the only sender in a server-backed build** (Phase 5). The
 * prototype's `CustomerService` and `LoyaltyService` send the welcome and
 * reward-available mails from the browser through the `Mailer` port; here the
 * routes do, because the route is what actually knows a card was created or a
 * reward minted, and because the provider credential must not be in a client
 * bundle (BACKEND-PLAN §3-C-13). Phase 6 must therefore wire the SPA's services
 * with `NoopMailer` under `VITE_DATASTORE=api` — two senders would mean two
 * mails, and the client's would be the one that cannot be trusted.
 *
 * Best-effort, exactly as the services are: a mail that fails must never fail
 * the registration or the commit that triggered it. The error goes to the log,
 * where the serializer scrubs it — `CLAUDE.md` rules PII out of logs, and a
 * provider error routinely quotes the recipient.
 */
function sendMail(
  deps: AuthDeps,
  request: FastifyRequest,
  mail: OutboundMail,
): void {
  deps.background.run(
    () => deps.mailer.send(mail),
    (err) => request.log.error({ err, kind: mail.kind }, 'transactional mail failed'),
  );
}

// ── routes ────────────────────────────────────────────────────────────────────

export function registerCustomerRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { sessions, store } = deps;

  /**
   * Registration — public, because a customer registering has nothing to
   * authenticate with yet. It is the one public write, so it carries the
   * strictest boundary in the file:
   *
   *   • name and email required (SCOPE-DECISIONS §2.1);
   *   • the token is generated here, never accepted (§3-B-10);
   *   • an address already in use is answered `email_in_use` so the page can
   *     offer recovery (§3.4) — and the *failure* is rate-limited per source
   *     address, so that answer cannot be walked across an address list;
   *   • the new card is bound to this device, which is what makes the customer
   *     session the durable recognition the prototype could not have.
   */
  app.post<{ Body: RegisterBody }>(
    '/customers',
    { schema: REGISTER_SCHEMA },
    async (request, reply) => {
      const key = `ip:${request.ip}`;
      const limited = deps.registerLimiter.check(key);
      if (!limited.allowed) {
        return reply
          .code(429)
          .header('retry-after', String(limited.retryAfterSec))
          .send({ error: 'rate_limited', retryAfterSec: limited.retryAfterSec });
      }

      const email = request.body.email.trim();
      const displayName = request.body.displayName.trim();
      if (!displayName || !isValidEmail(email)) {
        deps.registerLimiter.fail(key);
        return refuse(reply, 400, 'invalid_details');
      }

      let customer: Customer;
      try {
        customer = await store.createCustomer({
          token: generateToken(),
          displayName,
          email,
          phone: request.body.phone?.trim() || undefined,
          // Consent is the act of registering; its timestamp is the server's, so
          // a client cannot backdate it.
          consentAt: new Date().toISOString(),
        });
      } catch (err) {
        if (isUniqueViolation(err, EMAIL_IN_USE)) {
          deps.registerLimiter.fail(key);
          return refuse(reply, 409, 'email_in_use');
        }
        throw err;
      }

      // Two rows, matching `CustomerService.selfRegister` exactly so the trail
      // keeps its shape across the swap. `system` is the actor: no staff member
      // was involved, and the customer is not one.
      await store.appendAudit({
        actorId: 'system',
        actorRole: 'system',
        action: 'card.issue',
        targetId: customer.id,
        details: 'self-register',
      });
      await store.appendAudit({
        actorId: 'system',
        actorRole: 'system',
        action: 'customer.register',
        targetId: customer.id,
        details: 'with-details',
      });

      // Email is mandatory now (SCOPE-DECISIONS §2.1), so the welcome mail is
      // guaranteed rather than best-effort on whether one was given — which is
      // also what makes every card recoverable (§2.2).
      sendMail(deps, request, {
        to: customer.email as string,
        kind: 'card-created',
        params: { card_link: cardLink(deps.appUrl, customer.token) },
      });

      // A till registering a card for someone at the counter must not become
      // that customer's device — the same exemption `GET /customers/by-token`
      // and `PUT /me` make, for the same reason.
      if (request.auth?.record.kind !== 'staff') {
        const issued = await sessions.issueCustomer(customer.id);
        setSessionCookies(reply, deps, issued, cookieMaxAgeSec('customer', false));
      }
      return reply.code(201).send(customer);
    },
  );

  /**
   * Resolve a card by its token — public, because the token *is* the card's
   * credential: 128 random bits that carry no PII and are the only thing the QR
   * holds. Anyone presenting it is either the customer or holding the
   * customer's card, which the counter treats identically.
   *
   * It also **binds the card to this device** when the request carries no staff
   * session, replacing what `IdentityStore.set` did in localStorage: the last
   * card opened on a device is the card that device is recognised as, and a
   * server-set HttpOnly cookie survives the iOS ITP pruning that made the
   * prototype's recognition unreliable. A till is exempt — a staff member
   * resolving a customer's QR must never turn their terminal into that
   * customer's device.
   */
  app.get<{ Params: { token: string } }>('/customers/by-token/:token', async (request, reply) => {
    const token = request.params.token;
    const customer = isValidToken(token) ? await store.getCustomerByToken(token) : null;
    if (!customer || customer.status !== 'active') return notFound(reply);

    const alreadyBound = sessionCustomerId(request) === customer.id;
    if (!isActiveStaff(request) && !alreadyBound) {
      const issued = await sessions.issueCustomer(customer.id);
      setSessionCookies(reply, deps, issued, cookieMaxAgeSec('customer', false));
    }
    return customer;
  });

  /**
   * The camera-fail fallback: staff type the short code a customer reads aloud.
   * Staff-only — unlike the token this is 40 bits of human-friendly alphabet,
   * far too little to be a public credential.
   */
  app.get<{ Params: { shortCode: string } }>(
    '/customers/by-code/:shortCode',
    { preHandler: requireStaff },
    async (request, reply) => {
      const customer = await store.getCustomerByShortCode(
        normalizeShortCode(request.params.shortCode),
      );
      if (!customer || customer.status !== 'active') return notFound(reply);
      return customer;
    },
  );

  /**
   * Customer search. A POST for one reason: the term is a name, an email or a
   * phone number, and `GET /customers?term=…` would put it in the request line
   * — into the access log, the proxy log and the browser history (§3-B-11).
   */
  app.post<{ Body: { term: string } }>(
    '/customers/search',
    { schema: SEARCH_SCHEMA, preHandler: requireStaff },
    async (request) => store.findCustomers({ term: request.body.term }),
  );

  app.get<{ Params: IdParams }>('/customers/:id', async (request, reply) => {
    const customer = await readableCustomer(request, reply, deps);
    return customer ?? reply;
  });

  app.get<{ Params: IdParams }>('/customers/:id/state', async (request, reply) => {
    const customer = await readableCustomer(request, reply, deps);
    if (!customer) return reply;
    return store.getCustomerState(customer.id);
  });

  app.get<{ Params: IdParams; Querystring: { status?: RewardStatus } }>(
    '/customers/:id/rewards',
    async (request, reply) => {
      const customer = await readableCustomer(request, reply, deps);
      if (!customer) return reply;
      return store.listRewards(customer.id, request.query.status);
    },
  );

  app.get<{ Params: IdParams }>('/customers/:id/transactions', async (request, reply) => {
    const customer = await readableCustomer(request, reply, deps);
    if (!customer) return reply;
    return store.listTransactions(customer.id);
  });

  /**
   * Staff-mediated correction — a customer never edits their own card
   * (`DataStore.updateCustomer`: "never customer self-edit"). Audited as
   * `customer.correct` with the *field names* changed and never their values:
   * `CLAUDE.md` rules PII out of audit details as firmly as out of logs.
   */
  app.patch<{ Params: IdParams; Body: Record<string, string> }>(
    '/customers/:id',
    { schema: PATCH_SCHEMA, preHandler: requireStaff },
    async (request, reply) => {
      const actor = requireActor(request);
      const existing = await store.getCustomerById(request.params.id);
      if (!existing || existing.status !== 'active') return notFound(reply);

      if (request.body.email !== undefined && !isValidEmail(request.body.email)) {
        return refuse(reply, 400, 'invalid_details');
      }

      let updated: Customer;
      try {
        updated = await store.updateCustomer(request.params.id, {
          displayName: request.body.displayName?.trim(),
          email: request.body.email?.trim(),
          phone: request.body.phone?.trim(),
        });
      } catch (err) {
        if (isUniqueViolation(err, EMAIL_IN_USE)) return refuse(reply, 409, 'email_in_use');
        throw err;
      }

      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'customer.correct',
        targetId: updated.id,
        details: Object.keys(request.body).sort().join(','),
      });
      return updated;
    },
  );

  /**
   * Record consent. Open to the card's own device as well as to staff: consent
   * is the customer's to give, and registration already sets it — this is the
   * path for a card issued before consent was captured.
   */
  app.post<{ Params: IdParams }>('/customers/:id/consent', async (request, reply) => {
    const customer = await readableCustomer(request, reply, deps);
    if (!customer) return reply;
    // The timestamp is the server's, not the body's: a consent record a client
    // can date is not a consent record.
    return store.recordConsent(customer.id, new Date().toISOString());
  });

  /**
   * Reissue: rotate the opaque token, invalidating the old QR. Staff-only and
   * server-generated — a reissue whose new token the client chooses is not a
   * reissue.
   */
  app.post<{ Params: IdParams }>(
    '/customers/:id/rotate-token',
    { preHandler: requireStaff },
    async (request, reply) => {
      const actor = requireActor(request);
      const existing = await store.getCustomerById(request.params.id);
      if (!existing || existing.status !== 'active') return notFound(reply);

      const rotated = await store.rotateToken(existing.id, generateToken());
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'card.reissue',
        targetId: rotated.id,
      });
      return rotated;
    },
  );

  /**
   * Delete the card (SCOPE-DECISIONS §3.3). The row survives as a tombstone —
   * id, createdAt, status — and everything that resolves to a person is erased,
   * which keeps the ledger internally consistent, makes the dead token
   * unscannable, and frees the email for a fresh card starting at zero.
   *
   * Allowed to the card's own device or to an admin. Staff are deliberately not
   * on that list: erasing a customer on their behalf at the counter is not a
   * counter operation, and the customer's own device is always the one asking.
   */
  app.delete<{ Params: IdParams }>('/customers/:id', async (request, reply) => {
    const id = request.params.id;
    const isOwner = sessionCustomerId(request) === id;
    const isAdmin = isActiveStaff(request) && request.auth?.actor?.role === 'admin';
    if (!isOwner && !isAdmin) return notFound(reply);

    const existing = await store.getCustomerById(id);
    if (!existing || existing.status !== 'active') return notFound(reply);

    await store.softDeleteCustomer(id);
    const actor = request.auth?.actor;
    await store.appendAudit({
      actorId: actor?.id ?? 'system',
      actorRole: actor?.role ?? 'system',
      action: 'customer.delete',
      targetId: id,
    });

    // The card is gone; the cookie that recognised it must go with it, or the
    // device keeps a session pointing at a tombstone.
    if (isOwner && request.auth) await sessions.revoke(request.auth.record.id);
    return reply.code(204).send();
  });

  /**
   * The counter commit — accrue, mint on crossing, redeem 0..N — in one atomic,
   * idempotent store call.
   *
   * **§4-D lives here.** `staffId` is taken from the session and the body's is
   * dropped. `requireStaff` means a customer session cannot reach this at all,
   * so the anti-fraud anchor holds structurally rather than by convention.
   *
   * The audit rows are the route's (§4-C): one `loyalty.accrue` when points were
   * added, one `loyalty.redeem` per reward actually spent — the same rows
   * `LoyaltyService.commit` writes, because the two detectors read them and a
   * changed shape would silently change what they see. A **replayed** commit
   * writes none: the ledger is untouched on a retry and the audit log must be
   * too, or one accrual would look like two.
   */
  app.post<{ Params: IdParams; Body: CommitBody }>(
    '/customers/:id/commit',
    { schema: COMMIT_SCHEMA, preHandler: requireStaff },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = request.body;
      const limitKey = `staff:${actor.id}`;
      const limited = deps.commitLimiter.check(limitKey);
      if (!limited.allowed) {
        return reply
          .code(429)
          .header('retry-after', String(limited.retryAfterSec))
          .send({ error: 'rate_limited', retryAfterSec: limited.retryAfterSec });
      }

      const replay = await isCommitReplay(deps.db, body.idempotencyKey);

      const result: CommitResult = await store.commitCounterTransaction({
        customerId: request.params.id,
        pointsDelta: body.pointsDelta,
        redeemRewardIds: body.redeemRewardIds,
        // §4-D: the session's, never the body's.
        staffId: actor.id,
        idempotencyKey: body.idempotencyKey,
        source: body.source,
      });

      if (!result.ok) {
        // A commit that names a card that is not there, or asks for more than
        // the cap, is a caller probing or a client out of step — count it, so a
        // till walking the id space locks out while a busy counter never does.
        deps.commitLimiter.fail(limitKey);
        return reply.code(result.error === 'customer_not_found' ? 404 : 400).send(result);
      }
      deps.commitLimiter.succeed(limitKey);

      if (!replay) {
        if (body.pointsDelta > 0) {
          await store.appendAudit({
            actorId: actor.id,
            actorRole: actor.role,
            action: 'loyalty.accrue',
            targetId: request.params.id,
            details: `+${body.pointsDelta} ${body.source}`,
          });
        }
        for (let i = 0; i < result.redeemed.length; i += 1) {
          await store.appendAudit({
            actorId: actor.id,
            actorRole: actor.role,
            action: 'loyalty.redeem',
            targetId: request.params.id,
            details: body.source,
          });
        }

        // One reward-available mail per commit that minted something, matching
        // `LoyaltyService.commit`. A replay sends none, for the same reason it
        // writes no audit rows: the customer already got this mail.
        if (result.minted.length > 0) {
          const customer = await store.getCustomerById(request.params.id);
          const config = await store.getConfig();
          if (customer?.email) {
            sendMail(deps, request, {
              to: customer.email,
              kind: 'reward-available',
              params: {
                reward: config.rewardDescription,
                card_link: cardLink(deps.appUrl, customer.token),
              },
            });
          }
        }
      }

      return result;
    },
  );

  /**
   * Append a single ledger entry — the correction path, and the only one.
   *
   * `reversal` is validated server-side rather than trusted: the original must
   * exist, belong to this customer, not itself be a reversal, and not already be
   * reversed. Its `points` are **derived** from the original, so a caller cannot
   * send a reversal that credits more than it takes back. `LoyaltyService.reverse`
   * checks the same things on the client, where they are advisory.
   *
   * There is no post-commit undo here or anywhere (Appendix E, `CLAUDE.md`): a
   * correction is a new ledger entry that negates an old one, never an erasure.
   */
  app.post<{ Params: IdParams; Body: AppendBody }>(
    '/customers/:id/transactions',
    { schema: APPEND_TRANSACTION_SCHEMA, preHandler: requireStaff },
    async (request, reply) => {
      const actor = requireActor(request);
      const customerId = request.params.id;
      const customer = await store.getCustomerById(customerId);
      if (!customer || customer.status !== 'active') return notFound(reply);

      if (request.body.type === 'accrual') {
        const config = await store.getConfig();
        const points = clampAccrual(request.body.points ?? config.pointsPerPurchase, config);
        const tx = await store.appendTransaction({
          customerId,
          type: 'accrual',
          points,
          staffId: actor.id,
          note: request.body.note,
        });
        await store.appendAudit({
          actorId: actor.id,
          actorRole: actor.role,
          action: 'loyalty.accrue',
          targetId: customerId,
          details: `+${points}`,
        });
        return tx;
      }

      const targetId = request.body.reversesTransactionId;
      if (!targetId) return refuse(reply, 400, 'reversal_target_required');

      const ledger: LoyaltyTransaction[] = await store.listTransactions(customerId);
      const original = ledger.find((entry) => entry.id === targetId);
      if (!original) return refuse(reply, 404, 'reversal_target_not_found');
      if (original.type === 'reversal') return refuse(reply, 400, 'reversal_not_reversible');
      if (ledger.some((entry) => entry.reversesTransactionId === targetId)) {
        return refuse(reply, 409, 'already_reversed');
      }

      const tx = await store.appendTransaction({
        customerId,
        type: 'reversal',
        // Derived, not accepted: the body's `points` is ignored entirely.
        points: -original.points,
        staffId: actor.id,
        note: request.body.note,
        reversesTransactionId: targetId,
      });
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'loyalty.reverse',
        targetId: customerId,
        details: targetId,
      });
      return tx;
    },
  );

  // `POST /customers/:id/redeem` (`DataStore.redeemReward`) deliberately has no
  // route. The rewards-as-objects rework replaced it with the unified commit,
  // migration 001 refuses the `redemption` ledger entry it would write, and
  // `PostgresStore.redeemReward` throws for the same reason. Nothing in the
  // product calls it; it is removed from the port in Phase 11.
}
