/**
 * Plumbing shared by the API surface.
 *
 * Three things live here because getting any of them wrong in one route would
 * undo the guarantee the whole phase exists to provide:
 *
 *   • **The actor is the session's** (BACKEND-PLAN §2, §4-D). Every handler that
 *     attributes an action reads it from {@link requireActor}, never from a body.
 *   • **A staff account never leaves the server whole** ({@link publicStaff}).
 *     `StaffAccount` carries the argon2id digest of the password and of the PIN;
 *     the admin panel needs the name, username, role and active flag and nothing
 *     else.
 *   • **Reads are bounded at the boundary, not in the store** (§4-E). The store
 *     deliberately clamps nothing — the same calls feed the detectors, where a
 *     silent truncation would make them quietly wrong — so the ceiling belongs
 *     here, where the caller is known.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StaffAccount } from '@cafe/shared/domain/models';
import type { Db } from '../db';
import type { StaffActor } from '../auth/sessions';

/**
 * Most audit rows a single `GET /audit` may return. The client picks the limit
 * (Appendix E's staff counter asks for 10); this stops it asking for the table.
 */
export const AUDIT_LIMIT_CEILING = 200;

/** Most ledger rows a single ranged `GET /transactions` may return (§4-E). */
export const TRANSACTION_PAGE_CEILING = 1000;

/** Widest range `GET /transactions` accepts, so "everything" is not a query. */
export const TRANSACTION_RANGE_MAX_DAYS = 366;

/**
 * The signed-in staff identity. Behind `requireStaff`/`requireAdmin` this is
 * always present — the guard has already answered 401 otherwise — so the throw
 * is unreachable and exists to keep the type honest rather than to be caught.
 */
export function requireActor(request: FastifyRequest): StaffActor {
  const actor = request.auth?.actor;
  if (!actor) throw new Error('Route ran without a staff actor — guard missing?');
  return actor;
}

/** The customer this device is recognised as, or `null`. */
export function sessionCustomerId(request: FastifyRequest): string | null {
  const auth = request.auth;
  return auth?.record.kind === 'customer' ? auth.record.customerId : null;
}

/** True for an active (not idle-locked) staff or admin session. */
export function isActiveStaff(request: FastifyRequest): boolean {
  const auth = request.auth;
  return auth?.record.kind === 'staff' && auth.state === 'active' && auth.actor !== null;
}

/**
 * A `StaffAccount` safe to serialize.
 *
 * `passwordHash` is emptied rather than deleted: the field is required by the
 * shared `StaffAccount` type, and blanking it keeps one type across the seam
 * while guaranteeing the digest never crosses the wire. `pin` is dropped
 * entirely — its presence alone says whether the account can PIN-unlock, which
 * the admin panel does not need and an attacker would like.
 */
export function publicStaff(account: StaffAccount): StaffAccount {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    passwordHash: '',
    role: account.role,
    active: account.active,
    createdAt: account.createdAt,
  };
}

/**
 * Whether this idempotency key has already been committed.
 *
 * The route writes the audit rows for a commit (§4-C), and a retried commit
 * returns its cached result without writing to the ledger again — so without
 * this check the retry would append a second `loyalty.accrue` row for one
 * accrual, inflating exactly the data the self-dealing detector reads.
 *
 * It reads `idempotency_keys` directly because `CommitResult` does not say
 * whether it was served from the cache, and saying so would mean changing a
 * shared port type — which Phases 0–9 may not do. Two *simultaneous* retries
 * could still both see "fresh"; the ledger stays correct either way, and the
 * realistic retry (a client re-sending after a timeout) is covered.
 */
export async function isCommitReplay(db: Db, idempotencyKey: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM idempotency_keys WHERE key = $1', [
    idempotencyKey,
  ]);
  return (rowCount ?? 0) > 0;
}

/** 404 with a fixed body — never echoes back what was looked up. */
export function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'not_found' });
}

export function forbidden(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({ error: 'forbidden' });
}

/**
 * A refusal the caller can act on, as opposed to the generic `bad_request` the
 * server-wide error handler produces. Used only for outcomes a screen has a
 * remediation for (SCOPE-DECISIONS §2.4) — never for anything that would echo a
 * submitted value back.
 */
export function refuse(reply: FastifyReply, status: number, error: string): FastifyReply {
  return reply.code(status).send({ error });
}
