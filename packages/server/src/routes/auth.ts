/**
 * Staff authentication routes.
 *
 * Five routes, matching what `AuthContext` already does client-side — sign in,
 * PIN unlock, sign out, sign out everywhere, and "what is my session" for boot
 * reconciliation. The prototype's answers to all five came from localStorage;
 * these are the server's.
 *
 * Two contract problems from BACKEND-PLAN §4 are resolved here:
 *
 *   • **§4-A** — the client never hashes. `POST /auth/login` takes the plaintext
 *     over TLS and hands it to argon2id `verify`; `PostgresStore` did the hashing
 *     when the account was created. Nothing here re-hashes a hash.
 *   • **§4-B** — the port used to carry `getStaffByPin`, a *global* "which
 *     account has this PIN?" search, which over HTTP is an unauthenticated
 *     credential oracle across the whole staff table at four digits. It never
 *     got a route, and Phase 6 removed it from the port outright. `POST
 *     /auth/unlock` verifies the PIN against the account this device's session
 *     already identifies, rate-limited and locked out. That is a real
 *     divergence from prototype behaviour — a device with no session cannot PIN
 *     in at all — and is recorded as one in `STATUS.md`.
 *
 * Every failure answers the same way whatever went wrong (no such account, wrong
 * password, disabled account), so the route is not an account-enumeration
 * oracle. {@link burnEqualTime} keeps the *timing* from being one either.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { StaffAccount } from '@cafe/shared/domain/models';
import { hashSecret, verifySecret } from '../hashing';
import {
  clearSessionCookies,
  cookieMaxAgeSec,
  requireAdmin,
  setSessionCookies,
  type AuthDeps,
} from '../auth/guards';
import type { RateLimitDecision } from '../auth/rateLimit';
import type { SessionState, StaffActor } from '../auth/sessions';

const LOGIN_SCHEMA = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 64 },
      password: { type: 'string', minLength: 1, maxLength: 256 },
      remember: { type: 'boolean' },
    },
  },
};

const UNLOCK_SCHEMA = {
  body: {
    type: 'object',
    required: ['pin'],
    additionalProperties: false,
    properties: { pin: { type: 'string', pattern: '^\\d{4,8}$' } },
  },
};

interface LoginBody {
  username: string;
  password: string;
  remember?: boolean;
}

/**
 * A real argon2id digest of a value nobody knows, verified against when no
 * account matched. Without it "unknown username" answers in a millisecond while
 * "wrong password" takes fifty — an enumeration oracle readable with a
 * stopwatch. Computed once, lazily, so it never costs a boot.
 */
let decoyHash: Promise<string> | null = null;
async function burnEqualTime(password: string): Promise<void> {
  decoyHash ??= hashSecret(randomUUID());
  await verifySecret(await decoyHash, password);
}

function actorOf(account: StaffAccount): StaffActor {
  return { id: account.id, username: account.username, name: account.name, role: account.role };
}

/** The session body every route answers with. Never carries a credential. */
function sessionBody(actor: StaffActor, state: SessionState, epoch: number) {
  return { status: state, actor, epoch };
}

function firstRefusal(...decisions: RateLimitDecision[]): RateLimitDecision | null {
  return decisions.find((decision) => !decision.allowed) ?? null;
}

function rateLimited(reply: FastifyReply, decision: RateLimitDecision): FastifyReply {
  return reply
    .code(429)
    .header('retry-after', String(decision.retryAfterSec))
    .send({ error: 'rate_limited', retryAfterSec: decision.retryAfterSec });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { sessions, store } = deps;

  /**
   * Boot reconciliation. Public, and deliberately so — the SPA asks "am I signed
   * in?" before it knows the answer. The session cookie is the whole input; a
   * request without one gets `anon` rather than a 401, because not being signed
   * in is not an error.
   */
  app.get('/auth/session', async (request) => {
    const auth = request.auth;
    const epoch = await sessions.currentEpoch();
    if (!auth || auth.record.kind !== 'staff' || !auth.actor) {
      return { status: 'anon', epoch };
    }
    return { ...sessionBody(auth.actor, auth.state, epoch), remembered: auth.record.remembered };
  });

  /**
   * Username + password — the first sign-in on a device. `remember` makes it a
   * trusted terminal, which is what buys the PIN unlock after an idle lock.
   */
  app.post<{ Body: LoginBody }>('/auth/login', { schema: LOGIN_SCHEMA }, async (request, reply) => {
    const username = request.body.username.trim();
    const remember = request.body.remember === true;

    // Two buckets: the account under attack and the source doing the attacking.
    // Either alone leaves a hole — per-username misses a spray across accounts,
    // per-IP misses a botnet grinding one account.
    const userKey = `user:${username.toLowerCase()}`;
    const ipKey = `ip:${request.ip}`;
    const limited = firstRefusal(
      deps.loginUserLimiter.check(userKey),
      deps.loginIpLimiter.check(ipKey),
    );
    if (limited) return rateLimited(reply, limited);

    const account = await store.getStaffByUsername(username);
    const usable = account !== null && account.active;
    const ok = usable ? await verifySecret(account.passwordHash, request.body.password) : false;
    // Equal work whether or not the account exists, and whether or not it is
    // disabled, so the response time says nothing about either.
    if (!usable) await burnEqualTime(request.body.password);

    if (!ok || !account) {
      deps.loginUserLimiter.fail(userKey);
      deps.loginIpLimiter.fail(ipKey);
      // The username is never recorded — only the account id, when there is one.
      await store.appendAudit({
        actorId: account?.id ?? 'unknown',
        actorRole: 'system',
        action: 'staff.login.failed',
        targetId: account?.id,
      });
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    deps.loginUserLimiter.succeed(userKey);
    deps.loginIpLimiter.succeed(ipKey);

    const actor = actorOf(account);
    const issued = await sessions.issueStaff(account.id, remember);
    setSessionCookies(reply, deps, issued, cookieMaxAgeSec('staff', remember));
    await store.appendAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'staff.login',
      targetId: actor.id,
    });

    return {
      ...sessionBody(actor, 'active', issued.sessionEpoch),
      remembered: remember,
      // Also in a script-readable cookie; returned here so a client that cannot
      // read cookies (a native shell, a test) can still make mutating calls.
      csrfToken: issued.csrfToken,
    };
  });

  /**
   * PIN re-auth for a locked terminal (BACKEND-PLAN §4-B).
   *
   * The session names the account; the PIN only proves the person at the till is
   * still the person who signed in. A device with no session has nothing to
   * unlock and is told so — it signs in with the full form instead.
   */
  app.post<{ Body: { pin: string } }>(
    '/auth/unlock',
    { schema: UNLOCK_SCHEMA },
    async (request, reply) => {
      const auth = request.auth;
      const staffId = auth?.record.kind === 'staff' ? auth.record.staffId : null;
      if (!auth || !staffId) return reply.code(401).send({ error: 'unauthorized' });

      const key = `staff:${staffId}`;
      const limited = deps.pinLimiter.check(key);
      if (!limited.allowed) return rateLimited(reply, limited);

      // The port has no `getStaffById`, and adding one to reach a single row is
      // not worth widening the contract for a café's handful of accounts.
      const account = (await store.listStaff()).find((candidate) => candidate.id === staffId);
      const ok =
        account && account.active && account.pin
          ? await verifySecret(account.pin, request.body.pin)
          : false;

      if (!ok || !account) {
        deps.pinLimiter.fail(key);
        // Never record the PIN or any account detail beyond the id — it is a credential.
        await store.appendAudit({
          actorId: staffId,
          actorRole: 'system',
          action: 'staff.login.failed',
          targetId: staffId,
        });
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      deps.pinLimiter.succeed(key);
      await sessions.touch(auth.record.id);
      const actor = actorOf(account);
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'staff.login',
        targetId: actor.id,
      });

      return {
        ...sessionBody(actor, 'active', auth.record.sessionEpoch),
        remembered: auth.record.remembered,
      };
    },
  );

  /**
   * Sign out this device.
   *
   * Deliberately not behind `requireStaff`: a **locked** session is still a
   * session to end, and the guard refuses those. Signing out with no session at
   * all succeeds too — the caller wanted to be signed out, and they are.
   */
  app.post('/auth/logout', async (request, reply) => {
    if (request.auth) await sessions.revoke(request.auth.record.id);
    clearSessionCookies(reply, deps);
    return reply.code(204).send();
  });

  /**
   * Admin "sign out all devices". Deletes every staff session row and bumps the
   * epoch in one transaction — the caller's own session included, which is what
   * an admin pressing this expects.
   *
   * Audited as `config.update` / `sessionEpoch`, the same pair the prototype's
   * `StaffService.revokeAllSessions` writes, so the trail keeps its shape across
   * the swap.
   */
  app.post('/auth/logout-all', { preHandler: requireAdmin }, async (request, reply) => {
    const actor = request.auth?.actor;
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });

    const epoch = await sessions.revokeAllStaff();
    await store.appendAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'config.update',
      details: 'sessionEpoch',
    });
    clearSessionCookies(reply, deps);
    return { epoch };
  });
}
