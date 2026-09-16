/**
 * Activity, alerts and the bounded reads.
 *
 * The rule this file exists to enforce is a single sentence from BACKEND-PLAN
 * §2: **the API exposes no cross-account activity endpoint at all.** Appendix E
 * deleted every ambient feed; the triage (SCOPE-DECISIONS §1) went further and
 * deleted the sanctioned export too, which is how §4-F is "resolved by
 * deletion". A backend makes both trivially easy to re-add by accident — an
 * "admin activity" route added for convenience is one line — so the constraint
 * is written into the routes rather than left as an intention:
 *
 *   • `GET /audit` **overrides** the actor filter with the session's own id.
 *     Whatever the client asks for, it gets its own rows. Not "admins may ask
 *     for more": no tier can.
 *   • `POST /audit` writes nothing. A client-supplied actor and action is not an
 *     audit log (§4-C); the route that performed the action already wrote the
 *     row.
 *   • There is **no export route**, and migration 001 refuses an `audit.export`
 *     row outright, so one cannot be written even by mistake.
 *
 * Cross-account activity is reachable by querying the database directly, and by
 * `GET /alerts` — which returns *findings*, never rows, and is the whole of
 * BE-S-09's purpose.
 */

import type { FastifyInstance } from 'fastify';
import type { AuditAction } from '@cafe/shared/domain/models';
import type { AuthDeps } from '../auth/guards';
import { requireAdmin, requireStaff } from '../auth/guards';
import { deriveServerAlerts } from '../detection';
import {
  AUDIT_LIMIT_CEILING,
  TRANSACTION_PAGE_CEILING,
  TRANSACTION_RANGE_MAX_DAYS,
  refuse,
  requireActor,
} from './shared';

const DAY_MS = 24 * 60 * 60 * 1000;

const AUDIT_QUERY_SCHEMA = {
  querystring: {
    type: 'object',
    // The actor fields are accepted and discarded rather than rejected: the
    // client's `AuditFilter` carries them, and a 400 would tell a caller that
    // asking is interesting. Overriding them tells it nothing.
    additionalProperties: false,
    properties: {
      action: { type: 'string', maxLength: 40 },
      actions: { type: 'string', maxLength: 400 },
      actorId: { type: 'string', maxLength: 64 },
      actorIds: { type: 'string', maxLength: 400 },
      from: { type: 'string', maxLength: 40 },
      to: { type: 'string', maxLength: 40 },
      limit: { type: 'integer', minimum: 1, maximum: AUDIT_LIMIT_CEILING },
    },
  },
};

const RANGE_QUERY_SCHEMA = {
  querystring: {
    type: 'object',
    required: ['from', 'to'],
    additionalProperties: false,
    properties: {
      from: { type: 'string', minLength: 4, maxLength: 40 },
      to: { type: 'string', minLength: 4, maxLength: 40 },
      limit: { type: 'integer', minimum: 1, maximum: TRANSACTION_PAGE_CEILING },
    },
  },
};

interface AuditQuery {
  action?: string;
  actions?: string;
  from?: string;
  to?: string;
  limit?: number;
}

interface RangeQuery {
  from: string;
  to: string;
  limit?: number;
}

function parseActions(query: AuditQuery): AuditAction[] {
  const raw = [query.action, ...(query.actions?.split(',') ?? [])];
  return raw
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value)) as AuditAction[];
}

export function registerActivityRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { store } = deps;

  /**
   * "What have *I* done recently." Appendix E's staff counter shows the
   * signed-in actor's own last hour, capped at ten rows with no pager; this is
   * the read behind it, and it is the same read for an admin.
   *
   * The actor filter is the session's, always. The client may narrow by action
   * and by time; it cannot widen by actor, because there is no value of
   * `actorId` that would let it.
   */
  app.get<{ Querystring: AuditQuery }>(
    '/audit',
    { schema: AUDIT_QUERY_SCHEMA, preHandler: requireStaff },
    async (request) => {
      const actor = requireActor(request);
      const actions = parseActions(request.query);
      return store.listAudit({
        ...(actions.length > 0 ? { actions } : {}),
        // Not merged with the request's — replaced by it.
        actorIds: [actor.id],
        ...(request.query.from ? { from: request.query.from } : {}),
        ...(request.query.to ? { to: request.query.to } : {}),
        limit: Math.min(request.query.limit ?? AUDIT_LIMIT_CEILING, AUDIT_LIMIT_CEILING),
      });
    },
  );

  /**
   * `POST /audit`, refused (§4-C).
   *
   * Phase 6 moved `appendAudit` off `DataStore` and onto `TrustedStore`, so a
   * client-side adapter can no longer even express this call. The route stays
   * because an older client can still make it, and because the *attempt* is
   * worth seeing: it answers 204 rather than 403 (the route that performed the
   * action has already written the real row from the session actor, so there is
   * nothing for the caller to do about a refusal) and logs at `warn`, so a
   * missing server-side audit row shows up as noise rather than as silence.
   */
  app.post('/audit', { preHandler: requireStaff }, async (request, reply) => {
    request.log.warn('client attempted to write an audit row; ignored — audit is server-written');
    return reply.code(204).send();
  });

  /**
   * Derived suspicious-activity findings (BE-S-09). Admin tier: these name staff
   * members, and surfacing them is an owner's job, not a colleague's.
   *
   * This is the only cross-account view in the API, and it returns findings
   * rather than rows — which is exactly the line SCOPE-DECISIONS §3.1 draws when
   * it keeps the ranged audit query as an internal capability with no route.
   */
  app.get('/alerts', { preHandler: requireAdmin }, async () => deriveServerAlerts(store));

  /**
   * The ledger, ranged and capped (§4-E).
   *
   * `listAllTransactions()` is free against IndexedDB and an unbounded table
   * scan plus a multi-megabyte response here. The store still returns everything
   * — the stats derivation and the detectors read it in-process, where silent
   * truncation would make both quietly wrong — so the range and the page cap
   * live at the boundary, which is the only place that knows it is talking to a
   * browser.
   *
   * Known scaling divergence, recorded rather than pre-optimised: this keeps the
   * raw-row shape `domain/insights.ts` consumes. Real aggregate endpoints are
   * worth building only if a café's ledger ever makes this slow.
   */
  app.get<{ Querystring: RangeQuery }>(
    '/transactions',
    { schema: RANGE_QUERY_SCHEMA, preHandler: requireAdmin },
    async (request, reply) => {
      const from = Date.parse(request.query.from);
      const to = Date.parse(request.query.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        return refuse(reply, 400, 'invalid_range');
      }
      if (to - from > TRANSACTION_RANGE_MAX_DAYS * DAY_MS) {
        return refuse(reply, 400, 'range_too_wide');
      }

      const limit = Math.min(request.query.limit ?? TRANSACTION_PAGE_CEILING, TRANSACTION_PAGE_CEILING);
      const all = await store.listAllTransactions();
      const window = all.filter((tx) => {
        const at = Date.parse(tx.timestamp);
        return at >= from && at <= to;
      });

      // Truncation is reported, never silent: a caller that acts on a page it
      // thinks is the whole range would compute a wrong total.
      return {
        transactions: window.slice(0, limit),
        truncated: window.length > limit,
      };
    },
  );

  /** The one surviving stat read. Basic counts only (`CLAUDE.md`). */
  app.get('/stats/active-customers', { preHandler: requireAdmin }, async () =>
    store.countActiveCustomers(),
  );
}
