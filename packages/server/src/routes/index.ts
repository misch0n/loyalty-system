/**
 * The API surface, in one place.
 *
 * Registration order is not significant to Fastify — it routes by path, not by
 * declaration order — so the grouping here is for a reader: the three
 * authorization tiers, and which file holds each.
 *
 *   **public** — anyone, no session:
 *     `POST /customers`                      register (rate-limited)
 *     `GET  /customers/by-token/:token`      read a card by its own credential
 *     `GET|PUT|DELETE /me`                   this device's card recognition
 *     `POST /recovery/request`               email in, a code goes to the inbox
 *     `POST /recovery/consume`               email + code in, card bound here
 *     `GET  /auth/session`                   am I signed in? (Phase 3)
 *     `POST /auth/login` · `/auth/unlock` · `/auth/logout`
 *
 *   **customer's own card** — the device that card is bound to, or staff:
 *     `GET  /customers/:id` · `/state` · `/rewards` · `/transactions`
 *     `POST /customers/:id/consent`
 *     `DELETE /customers/:id`                the card's own device, or an admin
 *
 *   **staff** — an active staff or admin session:
 *     `GET  /customers/by-code/:shortCode`   camera-fail fallback
 *     `POST /customers/search`               PII in a body, never a URL
 *     `PATCH /customers/:id`                 staff-mediated correction
 *     `POST /customers/:id/rotate-token` · `/commit` · `/transactions`
 *     `GET  /config`
 *     `GET  /audit`                          the caller's own rows, always
 *     `POST /audit`                          accepted, writes nothing (§4-C)
 *
 *   **admin** — everything staff can, plus:
 *     `GET|POST /staff` · `PATCH /staff/:id` · `/password` · `/pin` · `DELETE`
 *     `PATCH /config`
 *     `GET  /alerts` · `/transactions` · `/stats/active-customers`
 *     `GET  /export` · `POST /import`
 *     `POST /auth/logout-all`
 *
 * And, as load-bearing as any route above, what is **absent**:
 *     no `POST /staff/by-pin`                 a credential oracle (§4-B)
 *     no `GET  /staff/by-username/:username`  returns the credential digests
 *     no `POST /customers/:id/redeem`         retired by rewards-as-objects
 *     no `POST /recovery/codes`               minting a code is an internal step
 *                                             of `/recovery/request`, never a
 *                                             thing a client asks for; and the
 *                                             port's `consumeRecoveryCode` is
 *                                             global-by-code, which a six-digit
 *                                             typed code cannot be (Phase 5)
 *     no cross-account activity read at all   (§4-F, SCOPE-DECISIONS §1)
 *     no undo of any kind                     (Appendix E)
 * `routes/guardrails.test.ts` fails if any of them appears.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthDeps } from '../auth/guards';
import { registerActivityRoutes } from './activity';
import { registerAuthRoutes } from './auth';
import { registerConfigRoutes } from './config';
import { registerCustomerRoutes } from './customers';
import { registerIdentityRoutes } from './identity';
import { registerRecoveryRoutes } from './recovery';
import { registerSnapshotRoutes } from './snapshot';
import { registerStaffRoutes } from './staff';

export function registerApiRoutes(app: FastifyInstance, deps: AuthDeps): void {
  registerAuthRoutes(app, deps);
  registerIdentityRoutes(app, deps);
  registerRecoveryRoutes(app, deps);
  registerCustomerRoutes(app, deps);
  registerStaffRoutes(app, deps);
  registerConfigRoutes(app, deps);
  registerActivityRoutes(app, deps);
  registerSnapshotRoutes(app, deps);
}
