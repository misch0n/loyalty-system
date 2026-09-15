/**
 * Backup and restore — admin tier, and the most dangerous pair of routes here.
 *
 * `importAll` **replaces the database**. `PostgresStore` implements it with
 * TRUNCATE, which is what makes a restore possible at all — the append-only
 * triggers reject row deletes, and must. So the import route is the one place
 * where an authenticated admin can destroy the ledger, and it is audited before
 * it runs: the `config.update` row naming `import` survives in the *restored*
 * log only if the snapshot contains it, which it will not, so the row is
 * written first and the operator's own trail records the attempt.
 *
 * Known gap, carried from Phase 2 rather than fixed here: `Snapshot` does not
 * carry rewards, reward events or recovery codes (BACKEND-PLAN §3-A-6). A
 * restore therefore loses materialized rewards. Widening `Snapshot` changes a
 * shared domain type, which Phases 0–9 may not do; Phase 10 or 11 is where it
 * belongs. Until then this is a **config-and-ledger** backup, not a full one,
 * and that is what the route's name should be read as promising.
 */

import type { FastifyInstance } from 'fastify';
import type { Snapshot } from '@cafe/shared/domain/models';
import type { AuthDeps } from '../auth/guards';
import { requireAdmin } from '../auth/guards';
import { publicStaff, requireActor } from './shared';

const IMPORT_SCHEMA = {
  body: {
    type: 'object',
    required: ['version', 'config', 'staff', 'customers', 'transactions', 'audit'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      exportedAt: { type: 'string', maxLength: 40 },
      config: { type: 'object' },
      staff: { type: 'array' },
      customers: { type: 'array' },
      transactions: { type: 'array' },
      audit: { type: 'array' },
    },
  },
};

export function registerSnapshotRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { store } = deps;

  /**
   * Export the snapshot.
   *
   * Staff accounts go through `publicStaff`, which means **the export cannot be
   * restored into a working system's credentials** — the digests are blanked, so
   * every account comes back unable to sign in. That is the deliberate trade:
   * a backup file is copied to laptops and cloud drives, and a file that carries
   * every argon2id digest in the café is a credential dump waiting to leak. A
   * restore is followed by setting passwords, which an operator with database
   * access can do.
   *
   * It is a customer-PII export either way, which is why it is admin-only and
   * why the export itself is audited.
   */
  app.get('/export', { preHandler: requireAdmin }, async (request) => {
    const actor = requireActor(request);
    const snapshot = await store.exportAll();
    await store.appendAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'config.update',
      details: 'export',
    });
    return { ...snapshot, staff: snapshot.staff.map(publicStaff) };
  });

  /** Restore a snapshot, replacing everything. Audited before it runs. */
  app.post<{ Body: Snapshot }>(
    '/import',
    { schema: IMPORT_SCHEMA, preHandler: requireAdmin },
    async (request, reply) => {
      const actor = requireActor(request);
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'config.update',
        details: 'import',
      });
      await store.importAll(request.body);
      return reply.code(204).send();
    },
  );
}
