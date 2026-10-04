/**
 * Staff authentication routes.
 *
 * Four routes — sign in, sign out, sign out everywhere, and "what is my
 * session" for boot reconciliation. The prototype's answers came from
 * localStorage; these are the server's.
 *
 * **There is no PIN and no idle lock** (SCOPE-DECISIONS §6.3, register S1). The
 * staff device is a shared till; a login lasts until its TTL — 30 days with
 * "remember me", 12 hours without — and the actor on every audit row is the
 * signed-in **account**. Audit rows, the counter's "your last hour" and both
 * alert detectors are therefore per account, not per person at the till. The
 * former PIN-unlock route went with the PIN.
 *
 * **§4-A** — the client never hashes. `POST /auth/login` takes the plaintext
 * over TLS and hands it to argon2id `verify`; `PostgresStore` did the hashing
 * when the account was created. Nothing here re-hashes a hash.
 *
 * Every failure answers the same way whatever went wrong (no such account, wrong
 * password, disabled account), so the route is not an account-enumeration
 * oracle. {@link burnEqualTime} keeps the *timing* from being one either.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { StaffAccount } from '@cafe/shared/domain/models';
import { hashSecret, verifySecret } from '../hashing.js';
import {
  clearSessionCookies,
  cookieMaxAgeSec,
  requireAdmin,
  setSessionCookies,
  type AuthDeps,
} from '../auth/guards.js';
import type { RateLimitDecision } from '../auth/rateLimit.js';
import type { StaffActor } from '../auth/sessions.js';

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
function sessionBody(actor: StaffActor, epoch: number) {
  return { status: 'active' as const, actor, epoch };
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
    return { ...sessionBody(auth.actor, epoch), remembered: auth.record.remembered };
  });

  /**
   * Username + password — the only sign-in. `remember` makes the login last the
   * long TTL (30 days) rather than the short one (12 hours); either way it is
   * never locked for idling.
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
      ...sessionBody(actor, issued.sessionEpoch),
      remembered: remember,
      // Also in a script-readable cookie; returned here so a client that cannot
      // read cookies (a native shell, a test) can still make mutating calls.
      csrfToken: issued.csrfToken,
    };
  });

  /**
   * Sign out this device.
   *
   * Deliberately not behind `requireStaff`: signing out with no session at all
   * succeeds — the caller wanted to be signed out, and they are.
   */
  app.post('/auth/logout', async (request, reply) => {
    if (request.auth) {
      // An `/events` stream outlives the request that opened it, so it is the
      // one thing a sign-out has to end explicitly. Without this the device
      // keeps a live channel on a session row that no longer exists.
      deps.events.closeSession(request.auth.record.id);
      await sessions.revoke(request.auth.record.id);
    }
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
    // Every staff stream, and only staff streams — the same line `revokeAllStaff`
    // draws. "Sign out all devices" is about terminals; a customer's card
    // recognition, and the channel keeping their card fresh, is untouched by it.
    deps.events.closeScope('staff');
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
