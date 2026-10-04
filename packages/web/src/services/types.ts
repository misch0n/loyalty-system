/** Shared service-layer types. */

import type { StaffRole } from '@cafe/shared/domain/models';

/**
 * The signed-in staff/admin account, for gating and display.
 *
 * It is **not** who the server records. Every route takes the actor from the
 * session cookie and ignores anything a request body says (BACKEND-PLAN §4-D),
 * so an `Actor` a service is handed decides what the screen offers, never what
 * the audit log says.
 */
export interface Actor {
  id: string;
  username: string;
  /** Display name for attribution/UI. Falls back to `username` when absent. */
  name?: string;
  role: StaffRole;
}

/**
 * The routes the `DataStore` port does not carry — `/auth/*`, `/recovery/*`,
 * `/alerts` — reached through the same client `ApiStore` uses, so they share its
 * cookies, its CSRF header and its one typed failure (`services/errors.ts`).
 * `ApiClient` satisfies it; the composition root is the only place that says so.
 */
export interface Api {
  request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T>;
}
