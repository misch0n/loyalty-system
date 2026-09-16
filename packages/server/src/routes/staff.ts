/**
 * Staff account management — admin tier, every route.
 *
 * `CLAUDE.md`: "Admin = superset of staff." An admin can do everything staff
 * can *and* manage accounts; staff can do none of this, which is what
 * `requireAdmin` on every route below says.
 *
 * Two things here are not in the prototype and have to be:
 *
 *   • **§4-A — the client never hashes.** The routes take the plaintext over
 *     TLS and `PostgresStore` hashes it with argon2id. The port used to call
 *     the parameter `passwordHash`, which promised the client sent a digest:
 *     had a store written what that name described, the "hash" *would be* the
 *     password, and anyone who could read the database could sign in with it.
 *     Phase 6 renamed it (`setStaffPassword(id, password)`); the wire field
 *     was always `password`.
 *   • **`GET /staff/by-username/:username` does not exist.** `getStaffByUsername`
 *     returns the account *including its credential digests*, and it is the
 *     prototype's login lookup. Sign-in is `POST /auth/login`, which verifies
 *     server-side and returns a session. Every account that does leave here goes
 *     through `publicStaff`.
 *
 * **The café can never be locked out of its own system**, and one rule is what
 * guarantees it: *an admin may not delete or disable the account they are
 * signed in with*. Everything here is admin-tier, so the caller is by definition
 * an active admin; refusing to let them act on themselves means an active admin
 * always remains, whoever else is removed.
 *
 * `StaffService.remove` carries a second check — "can't delete the last admin" —
 * which is **unreachable once the first holds**: the acting admin is itself an
 * active admin other than the target, so the target is never the last one. It is
 * not restated here, because a branch no request can enter is a branch no test
 * can cover. The invariant it was protecting is asserted directly in
 * `staff.test.ts` instead. The prototype needs it because its `Actor` is a
 * parameter rather than a session, so a caller there can claim to be anyone.
 *
 * The prototype never guarded *disabling* at all; disabling is guarded here too,
 * because a disabled admin loses their sessions on the next request and the
 * effect is a lockout just as complete as a deletion.
 */

import type { FastifyInstance } from 'fastify';
import type { StaffRole } from '@cafe/shared/domain/models';
import type { AuthDeps } from '../auth/guards.js';
import { requireAdmin } from '../auth/guards.js';
import { notFound, publicStaff, refuse, requireActor } from './shared.js';

const CREATE_SCHEMA = {
  body: {
    type: 'object',
    required: ['username', 'password', 'role'],
    additionalProperties: false,
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 64 },
      password: { type: 'string', minLength: 8, maxLength: 256 },
      role: { type: 'string', enum: ['admin', 'staff'] },
      name: { type: 'string', maxLength: 80 },
      pin: { type: 'string', pattern: '^\\d{4,8}$' },
    },
  },
};

const ACTIVE_SCHEMA = {
  body: {
    type: 'object',
    required: ['active'],
    additionalProperties: false,
    properties: { active: { type: 'boolean' } },
  },
};

const PASSWORD_SCHEMA = {
  body: {
    type: 'object',
    required: ['password'],
    additionalProperties: false,
    properties: { password: { type: 'string', minLength: 8, maxLength: 256 } },
  },
};

const PIN_SCHEMA = {
  body: {
    type: 'object',
    required: ['pin'],
    additionalProperties: false,
    properties: { pin: { type: 'string', pattern: '^\\d{4,8}$' } },
  },
};

interface IdParams {
  id: string;
}

interface CreateBody {
  username: string;
  password: string;
  role: StaffRole;
  name?: string;
  pin?: string;
}

export function registerStaffRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { store } = deps;

  /** The admin panel's account list — name · username · type, and nothing else. */
  app.get('/staff', { preHandler: requireAdmin }, async () =>
    (await store.listStaff()).map(publicStaff),
  );

  /**
   * Create a staff or admin account. `pin` is optional (a password-only account
   * simply cannot use the quick unlock) and is **not** checked for uniqueness —
   * SCOPE-DECISIONS §3.6 retired that rule, and against argon2id-hashed PINs it
   * is not implementable anyway. It stopped being needed when `/auth/unlock`
   * began verifying a PIN against an account the session already names, rather
   * than searching every account for a match.
   */
  app.post<{ Body: CreateBody }>(
    '/staff',
    { schema: CREATE_SCHEMA, preHandler: requireAdmin },
    async (request, reply) => {
      const actor = requireActor(request);
      const username = request.body.username.trim();
      if (!username) return refuse(reply, 400, 'invalid_details');
      if (await store.getStaffByUsername(username)) {
        return refuse(reply, 409, 'username_taken');
      }

      const account = await store.createStaff({
        username,
        // Plaintext over TLS; `PostgresStore` hashes with argon2id (§4-A).
        password: request.body.password,
        role: request.body.role,
        name: request.body.name?.trim() || undefined,
        pin: request.body.pin,
      });

      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'staff.create',
        targetId: account.id,
        details: request.body.role,
      });
      return reply.code(201).send(publicStaff(account));
    },
  );

  /**
   * Enable or disable an account. Disabling takes effect immediately, not at the
   * next sign-in: `SessionStore.resolve` joins `staff_accounts`, so a disabled
   * account's live sessions stop resolving on their very next request — which is
   * precisely when "disable this employee" matters.
   */
  app.patch<{ Params: IdParams; Body: { active: boolean } }>(
    '/staff/:id',
    { schema: ACTIVE_SCHEMA, preHandler: requireAdmin },
    async (request, reply) => {
      const actor = requireActor(request);
      const accounts = await store.listStaff();
      const target = accounts.find((account) => account.id === request.params.id);
      if (!target) return notFound(reply);

      // The whole lockout guard: the caller is an active admin, so refusing to
      // let them switch themselves off leaves at least one active admin however
      // many other accounts are disabled.
      if (!request.body.active && target.id === actor.id) {
        return refuse(reply, 409, 'cannot_disable_self');
      }

      await store.setStaffActive(target.id, request.body.active);
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: request.body.active ? 'staff.enable' : 'staff.disable',
        targetId: target.id,
      });
      return reply.code(204).send();
    },
  );

  /** Reset a password. Plaintext in, argon2id at rest, never echoed back (§4-A). */
  app.patch<{ Params: IdParams; Body: { password: string } }>(
    '/staff/:id/password',
    { schema: PASSWORD_SCHEMA, preHandler: requireAdmin },
    async (request, reply) => {
      const actor = requireActor(request);
      const accounts = await store.listStaff();
      if (!accounts.some((account) => account.id === request.params.id)) return notFound(reply);

      await store.setStaffPassword(request.params.id, request.body.password);
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'staff.resetPassword',
        targetId: request.params.id,
      });
      return reply.code(204).send();
    },
  );

  /**
   * Reset a PIN. Audited as `staff.resetPassword` with the detail `pin` — the
   * same pair `StaffService.setPin` writes, so the trail keeps its shape. The
   * PIN itself is never audited and never logged: it is a credential.
   */
  app.patch<{ Params: IdParams; Body: { pin: string } }>(
    '/staff/:id/pin',
    { schema: PIN_SCHEMA, preHandler: requireAdmin },
    async (request, reply) => {
      const actor = requireActor(request);
      const accounts = await store.listStaff();
      if (!accounts.some((account) => account.id === request.params.id)) return notFound(reply);

      await store.setStaffPin(request.params.id, request.body.pin);
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'staff.resetPassword',
        targetId: request.params.id,
        details: 'pin',
      });
      return reply.code(204).send();
    },
  );

  /**
   * Delete an account permanently. One guard, and it is the one that matters:
   * an admin cannot delete the account they are signed in with, which is what
   * makes "the last admin" a state no request can reach.
   *
   * The ledger and the audit log keep the departed account's id — neither
   * carries a foreign key to `staff_accounts`, precisely so historical
   * attribution survives a deletion.
   */
  app.delete<{ Params: IdParams }>(
    '/staff/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const actor = requireActor(request);
      const id = request.params.id;
      if (id === actor.id) return refuse(reply, 409, 'cannot_delete_self');

      const accounts = await store.listStaff();
      if (!accounts.some((account) => account.id === id)) return notFound(reply);

      // No session cleanup needed: `SessionStore.resolve` joins
      // `staff_accounts`, so the deleted account's sessions stop resolving —
      // and delete themselves — on their very next request.
      await store.deleteStaff(id);
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'staff.delete',
        targetId: id,
      });
      return reply.code(204).send();
    },
  );
}
