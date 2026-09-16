/**
 * Recovery — "I lost my card", reshaped by SCOPE-DECISIONS §2.3.
 *
 * Two public routes, and they are deliberately shaped as a pair:
 *
 *   `POST /recovery/request`   email in, a code goes to the inbox
 *   `POST /recovery/consume`   email + code in, the card is bound to this device
 *
 * The emailed magic link is gone. A link opens on whichever device reads the
 * mail — frequently a laptop when the customer is standing at the counter with
 * their phone — and binding the card to *that* device is the wrong answer. A
 * typed code binds the card to the device that typed it, which is the one in
 * their hand. Completing recovery is therefore also the **only** way to un-bind
 * a card from a device (§3.2): a customer who finds someone else's card on their
 * phone recovers their own, and the cookie is replaced.
 *
 * ## The opposite of registration, on purpose
 *
 * `POST /customers` answers `email_in_use` so the page can offer recovery
 * instead of a second card (§3.4) — a necessary answer, and an enumeration
 * oracle held shut by a failure-counting limiter. Recovery must not copy that
 * shape. Here an unknown address is **indistinguishable** from a known one:
 *
 *   • the same 202 and the same body, whatever the lookup found;
 *   • the same *timing*, because the lookup and the send happen after the
 *     response, as background work (`background.ts` explains why that is the
 *     honest fix rather than burning equal time);
 *   • one refusal string, `invalid_code`, for every way a consume can fail —
 *     no such address, wrong code, expired, already used, locked out.
 *
 * Only two things break that symmetry, and neither says anything about the
 * address: a 429 (earned by the *caller's* own behaviour) and a 403 for a till
 * trying to become a customer's device.
 *
 * ## What makes a six-character code safe
 *
 * Nothing about the code itself — see `recovery/codes.ts`. The controls are the
 * per-address scoping, the durable `attempts` lockout, and the limiters below.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { normalizeShortCode } from '@cafe/shared/domain/tokens';
import { normalizeEmail } from '@cafe/shared/domain/validation';
import type { AuthDeps } from '../auth/guards';
import { cookieMaxAgeSec, setSessionCookies } from '../auth/guards';
import type { AttemptLimiter, RateLimitDecision } from '../auth/rateLimit';
import {
  RECOVERY_EXPIRY_MINUTES,
  consumeRecoveryCode,
  issueRecoveryCode,
  recordFailedAttempt,
} from '../recovery/codes';
import { refuse } from './shared';

const REQUEST_SCHEMA = {
  body: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: { email: { type: 'string', minLength: 3, maxLength: 254 } },
  },
};

const CONSUME_SCHEMA = {
  body: {
    type: 'object',
    required: ['email', 'code'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254 },
      // Generous on length: the customer may type separators or spaces, which
      // `normalizeShortCode` strips before the code is checked.
      code: { type: 'string', minLength: 1, maxLength: 32 },
    },
  },
};

interface RequestBody {
  email: string;
}

interface ConsumeBody {
  email: string;
  code: string;
}

/**
 * The single answer to a recovery request. A constant, referenced from both the
 * route and its tests, so "known and unknown answer identically" is one fact
 * rather than two strings that have to be kept equal.
 */
export const RECOVERY_REQUEST_ACCEPTED = { status: 'sent' } as const;

/** The single refusal a consume can produce. Says nothing about which step failed. */
export const RECOVERY_INVALID = 'invalid_code';

function firstRefusal(...decisions: RateLimitDecision[]): RateLimitDecision | null {
  return decisions.find((decision) => !decision.allowed) ?? null;
}

function rateLimited(reply: FastifyReply, decision: RateLimitDecision): FastifyReply {
  return reply
    .code(429)
    .header('retry-after', String(decision.retryAfterSec))
    .send({ error: 'rate_limited', retryAfterSec: decision.retryAfterSec });
}

/**
 * Buckets are keyed on the *normalized* address, so `Bob@Example.test ` and
 * `bob@example.test` share a count — otherwise the limiter is bypassed by
 * changing the capitalization.
 */
function addressKey(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

function countRequest(limiter: AttemptLimiter, key: string): void {
  // `fail()` is the counter; there is no "success" here to clear it with,
  // because the route cannot see whether the address existed. See `AuthDeps`.
  limiter.fail(key);
}

export function registerRecoveryRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { background, mailer, sessions, store } = deps;

  /**
   * The active card for an address, or `null`. Uses only port methods, and the
   * same substring-then-exact-match shape as the prototype's `RecoveryService`,
   * so the two stay comparable.
   */
  async function cardFor(email: string) {
    const wanted = normalizeEmail(email);
    if (!wanted) return null;
    const matches = await store.findCustomers({ term: wanted });
    return (
      matches.find(
        (candidate) =>
          candidate.status === 'active' &&
          candidate.email !== undefined &&
          normalizeEmail(candidate.email) === wanted,
      ) ?? null
    );
  }

  /**
   * Step 1. Always 202, always the same body, always before any lookup has
   * happened — the response cannot depend on something the server has not done
   * yet, which is the strongest form of "no enumeration oracle" available.
   */
  app.post<{ Body: RequestBody }>(
    '/recovery/request',
    { schema: REQUEST_SCHEMA },
    async (request, reply) => {
      const emailKey = addressKey(request.body.email);
      const ipKey = `ip:${request.ip}`;
      const limited = firstRefusal(
        deps.recoveryRequestAddressLimiter.check(emailKey),
        deps.recoveryRequestIpLimiter.check(ipKey),
      );
      if (limited) return rateLimited(reply, limited);

      countRequest(deps.recoveryRequestAddressLimiter, emailKey);
      countRequest(deps.recoveryRequestIpLimiter, ipKey);

      const email = request.body.email;
      background.run(
        async () => {
          const customer = await cardFor(email);
          if (!customer || !customer.email) return;

          const code = await issueRecoveryCode(deps.db, customer.id);
          // Audited before the send, so the trail records that recovery was
          // requested even if the mail server is down. `system` is the actor and
          // the details carry no address — `CLAUDE.md` keeps PII out of the audit
          // log as firmly as out of the logs.
          await store.appendAudit({
            actorId: 'system',
            actorRole: 'system',
            action: 'customer.recover',
            targetId: customer.id,
            details: 'requested',
          });
          await mailer.send({
            to: customer.email,
            kind: 'recovery',
            params: { code, expiry_minutes: String(RECOVERY_EXPIRY_MINUTES) },
          });
        },
        // The error is logged, never returned: the caller already has its 202,
        // and telling it the send failed would be the oracle this route exists
        // to avoid. The serializer scrubs whatever the provider put in there.
        (err) => request.log.error({ err }, 'recovery delivery failed'),
      );

      return reply.code(202).send(RECOVERY_REQUEST_ACCEPTED);
    },
  );

  /**
   * Step 2. The code is checked **against the card that asked for it**, never
   * against every live code in the table (`recovery/codes.ts` explains why that
   * distinction is the whole security of a short code).
   *
   * On success this is `IdentityStore.set`, server-side: the device is bound to
   * the card by an HttpOnly cookie, which is the recognition that survives the
   * iOS ITP pruning the prototype could not.
   */
  app.post<{ Body: ConsumeBody }>(
    '/recovery/consume',
    { schema: CONSUME_SCHEMA },
    async (request, reply) => {
      // A till must never become a customer's device — the same refusal
      // `PUT /me` makes, for the same reason. Keyed on the caller's own session,
      // so it reveals nothing about the address.
      if (request.auth?.record.kind === 'staff') return refuse(reply, 403, 'staff_device');

      const emailKey = addressKey(request.body.email);
      const ipKey = `ip:${request.ip}`;
      const limited = firstRefusal(
        deps.recoveryConsumeAddressLimiter.check(emailKey),
        deps.recoveryConsumeIpLimiter.check(ipKey),
      );
      if (limited) return rateLimited(reply, limited);

      const customer = await cardFor(request.body.email);
      const code = normalizeShortCode(request.body.code);
      const ok = customer !== null && (await consumeRecoveryCode(deps.db, customer.id, code));

      if (!ok) {
        deps.recoveryConsumeAddressLimiter.fail(emailKey);
        deps.recoveryConsumeIpLimiter.fail(ipKey);
        // The durable half of the lockout: five wrong guesses burn the code in
        // the database, so restarting the process does not buy five more.
        if (customer) await recordFailedAttempt(deps.db, customer.id);
        return refuse(reply, 400, RECOVERY_INVALID);
      }

      deps.recoveryConsumeAddressLimiter.succeed(emailKey);
      deps.recoveryConsumeIpLimiter.succeed(ipKey);

      await store.appendAudit({
        actorId: 'system',
        actorRole: 'system',
        action: 'customer.recover',
        targetId: customer.id,
        details: 'redeemed',
      });

      // Replace rather than add: a device is recognised as exactly one card.
      if (request.auth) await sessions.revoke(request.auth.record.id);
      const issued = await sessions.issueCustomer(customer.id);
      setSessionCookies(reply, deps, issued, cookieMaxAgeSec('customer', false));
      return { token: customer.token };
    },
  );
}
