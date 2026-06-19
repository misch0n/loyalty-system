/**
 * Auth session for the staff/admin side of the prototype.
 *
 * Holds the logged-in Actor and persists it in sessionStorage so a refresh
 * doesn't kick staff out mid-demo. Customer-facing screens need no session.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Actor } from '../../services/types';

interface SessionValue {
  actor: Actor | null;
  setActor: (actor: Actor | null) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);
const STORAGE_KEY = 'cafe-loyalty.actor';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Actor) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (actor) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(actor));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, [actor]);

  const value = useMemo<SessionValue>(
    () => ({ actor, setActor, logout: () => setActor(null) }),
    [actor],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider.');
  return ctx;
}
