/** Shared service-layer types. */

import type { StaffRole } from '../domain/models';

/** The authenticated staff/admin performing an action (for audit + gating). */
export interface Actor {
  id: string;
  username: string;
  role: StaffRole;
}
