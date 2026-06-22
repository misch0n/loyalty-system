/** Shared service-layer types. */

import type { StaffRole } from '../domain/models';

/** The authenticated staff/admin performing an action (for audit + gating). */
export interface Actor {
  id: string;
  username: string;
  role: StaffRole;
}

/**
 * The system itself as the audit actor, for customer-initiated actions that have
 * no staff behind them (self-registration, self-service recovery).
 */
export const SYSTEM_ACTOR = { id: 'system', role: 'system' as const };
