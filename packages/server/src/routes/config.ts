/**
 * Program configuration — read by staff, written by admins.
 *
 * The read is staff-tier because the counter needs it: the per-scan cap, the
 * reward threshold and the reward description all shape what the till shows and
 * what it will accept. The write is admin-tier and clamped server-side
 * (`config/clamp.ts`) — `ConfigService.sanitizeConfig` does the same arithmetic
 * in the browser, which is presentation, not enforcement.
 *
 * `sessionEpoch` is refused rather than clamped. Revocation is
 * `POST /auth/logout-all`, which deletes the session rows *and* bumps the epoch
 * in one transaction; a config field a client can set would let it lower the
 * epoch and un-revoke everything that had just been cancelled.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthDeps } from '../auth/guards';
import { requireAdmin, requireStaff } from '../auth/guards';
import { clampConfigPatch } from '../config/clamp';
import { refuse, requireActor } from './shared';

const PATCH_SCHEMA = {
  body: {
    type: 'object',
    // Deliberately open: `clampConfigPatch` is the allow-list, and it is the one
    // that also has to refuse `sessionEpoch` by name. A schema that rejected the
    // field would answer `invalid_request`, which reads like a typo rather than
    // like "that is not a thing you set here".
    minProperties: 1,
  },
};

export function registerConfigRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { store } = deps;

  app.get('/config', { preHandler: requireStaff }, async () => store.getConfig());

  app.patch<{ Body: Record<string, unknown> }>(
    '/config',
    { schema: PATCH_SCHEMA, preHandler: requireAdmin },
    async (request, reply) => {
      const actor = requireActor(request);
      const clamped = clampConfigPatch(request.body);
      if (!clamped.ok) return refuse(reply, 400, clamped.error);

      const config = await store.updateConfig(clamped.patch);
      // The changed *field names*, as `ConfigService.update` records them —
      // never the values, which is what keeps a reward description out of the
      // audit log.
      await store.appendAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'config.update',
        details: Object.keys(clamped.patch).sort().join(','),
      });
      return config;
    },
  );
}
