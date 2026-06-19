/** Route guard: gate staff/admin screens behind login + role. */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './SessionContext';

interface Props {
  children: ReactNode;
  /** When set, requires the actor to be an admin. */
  requireAdmin?: boolean;
}

export function RequireAuth({ children, requireAdmin }: Props) {
  const { actor } = useSession();
  const location = useLocation();

  if (!actor) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (requireAdmin && actor.role !== 'admin') {
    return (
      <div className="card notice">
        <h2>Admins only</h2>
        <p>You're signed in as staff. Ask an admin for access to this section.</p>
      </div>
    );
  }
  return <>{children}</>;
}
