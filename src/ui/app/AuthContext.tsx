/**
 * Staff/admin session model (UX-SPEC §6).
 *
 * The long-press is discovery obfuscation; the PIN is the access control. This
 * context owns the authenticated staff identity, the trusted-device flag, and
 * the 5-minute inactivity timeout. It never persists the PIN — only the minimum
 * needed to recognize a trusted device and enforce the timeout.
 *
 * Persistence shape (no PII beyond the staff attribution NAME, which is required
 * for the activity log per §6):
 *   - trusted device  → localStorage   'cafe-loyalty.staffDevice'
 *   - ephemeral login → sessionStorage  'cafe-loyalty.staffSession'
 *   both hold { actorId, username, role, epoch, lastActivity }.
 *
 * Boot resolution (UX-SPEC §2 staff branch):
 *   - stored epoch < server epoch              → REVOKED → clear → 'anon'
 *   - now - lastActivity > 5min, trusted       → 'locked' (keep identity to unlock)
 *   - now - lastActivity > 5min, ephemeral     → clear → 'anon'
 *   - else                                     → 'active', actor restored
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Actor } from '../../services/types';
import type { StaffRole } from '../../domain/models';
import { useServices } from '../common/ServicesContext';

const DEVICE_KEY = 'cafe-loyalty.staffDevice';
const SESSION_KEY = 'cafe-loyalty.staffSession';

/** Inactivity window before a session locks (trusted) or ends (ephemeral). */
export const INACTIVITY_MS = 5 * 60 * 1000;
/** How often the internal timer checks for expiry. */
const TICK_MS = 15 * 1000;

export type AuthStatus = 'anon' | 'active' | 'locked';

export interface AuthValue {
  /** Signed-in staff/admin (null = customer / anonymous visitor). */
  actor: Actor | null;
  /** 'active' = usable; 'locked' = trusted device needs PIN re-auth; 'anon'. */
  status: AuthStatus;
  /** True when "remember this device" was ON (a trusted café terminal). */
  trusted: boolean;
  /** PIN sign-in. `remember` makes the device a trusted terminal. */
  loginWithPin(pin: string, remember: boolean): Promise<{ ok: boolean; reason?: string }>;
  /** Re-auth a locked trusted device. Must resolve to the same actor id. */
  unlock(pin: string): Promise<{ ok: boolean; reason?: string }>;
  /** Full sign-out: clears actor and device trust. */
  logout(): void;
  /** Reset the inactivity timer (call on scan/credit/redeem/nav). */
  recordActivity(): void;
  /**
   * False until the boot reconciliation (epoch check + timeout) has settled.
   * Consumers that branch on `status`/`trusted` at startup (e.g. the entry
   * resolver) should wait for this to avoid acting on the pre-boot 'anon'
   * default. Not part of the core session contract — purely a readiness gate.
   */
  ready: boolean;
}

/** What we persist to recognize a trusted device and enforce the timeout. */
interface PersistedSession {
  actorId: string;
  username: string;
  role: StaffRole;
  epoch: number;
  lastActivity: number;
}

const AuthContext = createContext<AuthValue | null>(null);

function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'staff';
}

/** Parse a persisted blob, tolerating any malformed/legacy storage. */
function parseSession(raw: string | null): PersistedSession | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    if (
      typeof o.actorId === 'string' &&
      typeof o.username === 'string' &&
      isStaffRole(o.role) &&
      typeof o.epoch === 'number' &&
      typeof o.lastActivity === 'number'
    ) {
      return {
        actorId: o.actorId,
        username: o.username,
        role: o.role,
        epoch: o.epoch,
        lastActivity: o.lastActivity,
      };
    }
  } catch {
    // malformed JSON → treat as no session
  }
  return null;
}

function readPersisted(): { session: PersistedSession; trusted: boolean } | null {
  try {
    const device = parseSession(localStorage.getItem(DEVICE_KEY));
    if (device) return { session: device, trusted: true };
    const ephemeral = parseSession(sessionStorage.getItem(SESSION_KEY));
    if (ephemeral) return { session: ephemeral, trusted: false };
  } catch {
    // storage unavailable (private mode, disabled) → behave as anon
  }
  return null;
}

function actorFrom(session: PersistedSession): Actor {
  return { id: session.actorId, username: session.username, role: session.role };
}

function clearStorage(): void {
  try {
    localStorage.removeItem(DEVICE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}

function persist(session: PersistedSession, trusted: boolean): void {
  try {
    const raw = JSON.stringify(session);
    if (trusted) {
      localStorage.setItem(DEVICE_KEY, raw);
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, raw);
      localStorage.removeItem(DEVICE_KEY);
    }
  } catch {
    // best-effort: a session that can't persist simply won't survive reload
  }
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const services = useServices();

  const [actor, setActor] = useState<Actor | null>(null);
  const [status, setStatus] = useState<AuthStatus>('anon');
  const [trusted, setTrusted] = useState(false);
  const [ready, setReady] = useState(false);

  // The authoritative session record lives in a ref so the timer reads fresh
  // values without re-subscribing; React state mirrors it for rendering.
  const sessionRef = useRef<PersistedSession | null>(null);
  const trustedRef = useRef(false);
  const statusRef = useRef<AuthStatus>('anon');
  statusRef.current = status;

  const applyAnon = useCallback(() => {
    sessionRef.current = null;
    trustedRef.current = false;
    setActor(null);
    setTrusted(false);
    setStatus('anon');
  }, []);

  const logout = useCallback(() => {
    clearStorage();
    applyAnon();
  }, [applyAnon]);

  // Boot: restore + reconcile against the server epoch and the timeout.
  useEffect(() => {
    let cancelled = false;
    const restored = readPersisted();
    if (!restored) {
      applyAnon();
      setReady(true);
      return;
    }
    void services.staff
      .currentSessionEpoch()
      .then((serverEpoch) => {
        if (cancelled) return;
        const { session, trusted: isTrusted } = restored;
        // Revoked: admin bumped the epoch past this device's stored one.
        if (serverEpoch > session.epoch) {
          clearStorage();
          applyAnon();
          return;
        }
        const idle = Date.now() - session.lastActivity > INACTIVITY_MS;
        if (idle) {
          if (isTrusted) {
            // Keep the identity so the unlock screen can re-auth, but locked.
            sessionRef.current = session;
            trustedRef.current = true;
            setActor(actorFrom(session));
            setTrusted(true);
            setStatus('locked');
          } else {
            clearStorage();
            applyAnon();
          }
          return;
        }
        // Fresh enough → active.
        sessionRef.current = session;
        trustedRef.current = isTrusted;
        setActor(actorFrom(session));
        setTrusted(isTrusted);
        setStatus('active');
      })
      .catch(() => {
        if (!cancelled) applyAnon();
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [services, applyAnon]);

  const recordActivity = useCallback(() => {
    const session = sessionRef.current;
    if (!session || statusRef.current !== 'active') return;
    const updated: PersistedSession = { ...session, lastActivity: Date.now() };
    sessionRef.current = updated;
    // Persist so a reload within the window stays active.
    persist(updated, trustedRef.current);
  }, []);

  // Inactivity timer: on expiry, trusted → locked, ephemeral → logout.
  useEffect(() => {
    if (status !== 'active') return;
    const id = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      if (Date.now() - session.lastActivity > INACTIVITY_MS) {
        if (trustedRef.current) {
          setStatus('locked');
        } else {
          logout();
        }
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [status, logout]);

  const loginWithPin = useCallback(
    async (pin: string, remember: boolean): Promise<{ ok: boolean; reason?: string }> => {
      const result = await services.staff.loginWithPin(pin);
      if (!result.ok || !result.actor) {
        return { ok: false, reason: result.reason };
      }
      const epoch = await services.staff.currentSessionEpoch();
      const signedIn = result.actor;
      const session: PersistedSession = {
        actorId: signedIn.id,
        username: signedIn.username,
        role: signedIn.role,
        epoch,
        lastActivity: Date.now(),
      };
      sessionRef.current = session;
      trustedRef.current = remember;
      persist(session, remember);
      setActor(signedIn);
      setTrusted(remember);
      setStatus('active');
      return { ok: true };
    },
    [services],
  );

  const unlock = useCallback(
    async (pin: string): Promise<{ ok: boolean; reason?: string }> => {
      const current = sessionRef.current;
      if (!current) return { ok: false, reason: 'No locked session to unlock.' };
      const result = await services.staff.loginWithPin(pin);
      if (!result.ok || !result.actor) {
        return { ok: false, reason: result.reason };
      }
      // Quick unlock, not a re-enrol: the PIN must resolve to the same actor.
      if (result.actor.id !== current.actorId) {
        return { ok: false, reason: 'That PIN belongs to a different account.' };
      }
      const updated: PersistedSession = { ...current, lastActivity: Date.now() };
      sessionRef.current = updated;
      // The device stays trusted across an unlock.
      persist(updated, trustedRef.current);
      setActor(actorFrom(updated));
      setStatus('active');
      return { ok: true };
    },
    [services],
  );

  const value = useMemo<AuthValue>(
    () => ({ actor, status, trusted, loginWithPin, unlock, logout, recordActivity, ready }),
    [actor, status, trusted, loginWithPin, unlock, logout, recordActivity, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within an AuthProvider.');
  return value;
}
