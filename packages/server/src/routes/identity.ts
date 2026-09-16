/**
 * `/me` — the `IdentityStore` port, server-side.
 *
 * "This browser remembers which customer it belongs to." The prototype keeps
 * that in localStorage, which `COLLAB-NOTES.md` records as the durability gap
 * that is a large part of why this backend exists: on iOS, ITP eventually
 * prunes script-written storage, and a customer's card quietly stops being
 * recognised. A server-set HttpOnly cookie is not script-reachable and is not
 * pruned the same way.
 *
 * The port stores **only the opaque token, never PII**, and these three routes
 * keep that true: the cookie carries a session id, the session row carries a
 * customer id, and the only thing that ever comes back over the wire is the
 * card's own token.
 */

import type { FastifyInstance } from 'fastify';
import { isValidToken } from '@cafe/shared/domain/tokens';
import type { AuthDeps } from '../auth/guards.js';
import { clearSessionCookies, cookieMaxAgeSec, setSessionCookies } from '../auth/guards.js';
import { refuse, sessionCustomerId } from './shared.js';

const SET_SCHEMA = {
  body: {
    type: 'object',
    required: ['token'],
    additionalProperties: false,
    properties: { token: { type: 'string', minLength: 8, maxLength: 64 } },
  },
};

export function registerIdentityRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { sessions, store } = deps;

  /**
   * `IdentityStore.get`. Public, and answers `{ token: null }` rather than 401
   * when this browser is not recognised — "I don't know you" is the expected
   * answer to the question, not an error, exactly as `GET /auth/session` treats
   * a signed-out staff device.
   *
   * A session pointing at a deleted card also answers `null`: the tombstone has
   * no token left (SCOPE-DECISIONS §3.3), so there is nothing to be recognised
   * as.
   */
  app.get('/me', async (request) => {
    const customerId = sessionCustomerId(request);
    if (!customerId) return { token: null };
    const customer = await store.getCustomerById(customerId);
    if (!customer || customer.status !== 'active') return { token: null };
    return { token: customer.token };
  });

  /**
   * `IdentityStore.set` — bind this browser to a card.
   *
   * Presenting the token is the authorization: it is the card's credential, the
   * same 128 bits the QR carries. The two moments the SPA calls this are
   * registration and a completed recovery, which are precisely the two moments
   * SCOPE-DECISIONS §2.3/§3.2 describe as binding a card to a device.
   *
   * A staff session is refused rather than replaced. A till that quietly became
   * a customer's device would be recognised as that customer on its next boot,
   * and `CLAUDE.md` is explicit that staff and customer roles do not blur.
   */
  app.put<{ Body: { token: string } }>(
    '/me',
    { schema: SET_SCHEMA },
    async (request, reply) => {
      if (request.auth?.record.kind === 'staff') return refuse(reply, 403, 'staff_device');

      const token = request.body.token;
      const customer = isValidToken(token) ? await store.getCustomerByToken(token) : null;
      if (!customer || customer.status !== 'active') return refuse(reply, 404, 'not_found');

      // Replace rather than add: a device is recognised as exactly one card, the
      // same one-token-in-localStorage shape the prototype has.
      if (request.auth) await sessions.revoke(request.auth.record.id);
      const issued = await sessions.issueCustomer(customer.id);
      setSessionCookies(reply, deps, issued, cookieMaxAgeSec('customer', false));
      return { token: customer.token };
    },
  );

  /**
   * `IdentityStore.clear` — forget the card on this browser (a shared or staff
   * device). Succeeds with nothing to forget: the caller wanted to be
   * unrecognised, and they are.
   */
  app.delete('/me', async (request, reply) => {
    if (request.auth?.record.kind === 'customer') {
      await sessions.revoke(request.auth.record.id);
      clearSessionCookies(reply, deps);
    }
    return reply.code(204).send();
  });
}
