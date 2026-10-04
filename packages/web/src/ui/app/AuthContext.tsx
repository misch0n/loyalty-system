/**
 * Staff/admin session model (UX-SPEC §6, as amended by S1).
 *
 * The long-press is discovery obfuscation; the password is the access control,
 * and the server's HttpOnly session cookie is the session. This context mirrors
 * that session for rendering: who is signed in, and whether the login was
 * remembered. There is **no PIN and no idle lock** (SCOPE-DECISIONS §6.3): the
 * staff device is a shared till, and a login lasts until its server-side TTL —
 * 30 days remembered, 12 hours otherwise — or until "Sign out all devices".
 *
 * Persistence shape (no PII beyond the staff attribution NAME):
 *   - remembered login → localStorage   'cafe-loyalty.staffDevice'
 *   - ephemeral login  → sessionStorage  'cafe-loyalty.staffSession'
 *   both hold { actorId, username, name?, role, epoch }.
 *
 * Boot resolution (UX-SPEC §2 staff branch):
 *   - stored epoch < server epoch              → REVOKED → clear → 'anon'
 *   - else                                     → 'active', actor restored
 * A cookie that expired under a persisted session is caught by the first API
 * call it makes: a `signed_out` failure, which `ConnectionWatch` turns into a
 * `logout()`. Reconciling against `GET /auth/session` itself is UI-3 (X1).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Actor } from '../../services/types';
import { useServices } from '../common/ServicesContext';
import { parseSession, reconcile, type AuthStatus, type PersistedSession } from './session';

const DEVICE_KEY = 'cafe-loyalty.staffDevice';
const SESSION_KEY = 'cafe-loyalty.staffSession';
/** Last signed-in username, kept (no password) to prefill the sign-in form. */
const LAST_USER_KEY = 'cafe-loyalty.lastUser';

export type { AuthStatus } from './session';

export interface AuthValue {
  /** Signed-in staff/admin (null = customer / anonymous visitor). */
  actor: Actor | null;
  /** 'active' = signed in; 'anon' = not. */
  status: AuthStatus;
  /** True when "remember this device" was ON (a 30-day login on a café till). */
  trusted: boolean;
  /**
   * Username/password sign-in. `remember` makes the login last 30 days rather
   * than 12 hours. Resolves with the signed-in actor on success so the caller
   * can route by role.
   */
  loginWithPassword(
    username: string,
    password: string,
    remember: boolean,
  ): Promise<{ ok: boolean; actor?: Actor; reason?: string }>;
  /**
   * The last username that signed in on this device (no credential stored).
   * Used to prefill the sign-in form so a returning, non-remembered device asks
   * for the last user's password rather than a blank form.
   */
  lastUsername: string | null;
  /** Full sign-out: ends the server session and clears actor and device trust. */
  logout(): void;
  /**
   * False until the boot reconciliation (the epoch check) has settled.
   * Consumers that branch on `status`/`trusted` at startup (e.g. the entry
   * resolver) should wait for this to avoid acting on the pre-boot 'anon'
   * default. Not part of the core session contract — purely a readiness gate.
   */
  ready: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

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

function clearStorage(): void {
  try {
    localStorage.removeItem(DEVICE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}

function readLastUsername(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

function rememberLastUsername(username: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, username);
  } catch {
    // best-effort: prefill is a convenience, not required
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
  const [lastUsername, setLastUsername] = useState<string | null>(() => readLastUsername());

  const applyAnon = useCallback(() => {
    setActor(null);
    setTrusted(false);
    setStatus('anon');
  }, []);

  const logout = useCallback(() => {
    clearStorage();
    applyAnon();
    // Best-effort: the route succeeds with no session at all, and a device that
    // cannot reach the server is signed out locally either way.
    void services.staff.logout().catch(() => undefined);
  }, [services, applyAnon]);

  // Boot: restore + reconcile against the server epoch.
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
        const outcome = reconcile(session, serverEpoch);
        if (outcome.status === 'anon') {
          // Revoked: nothing to keep.
          clearStorage();
          applyAnon();
          return;
        }
        setActor(outcome.actor);
        setTrusted(isTrusted);
        setStatus(outcome.status);
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

  const loginWithPassword = useCallback(
    async (
      username: string,
      password: string,
      remember: boolean,
    ): Promise<{ ok: boolean; actor?: Actor; reason?: string }> => {
      const result = await services.staff.login(username, password, remember);
      if (!result.ok || !result.actor || result.epoch === undefined) {
        return { ok: false, reason: result.reason };
      }
      // The login answer carries the epoch; a second request here could fail
      // after the session cookie was already set, and report a sign-in that worked
      // as one that did not.
      const epoch = result.epoch;
      const signedIn = result.actor;
      const session: PersistedSession = {
        actorId: signedIn.id,
        username: signedIn.username,
        name: signedIn.name,
        role: signedIn.role,
        epoch,
      };
      persist(session, remember);
      rememberLastUsername(signedIn.username);
      setLastUsername(signedIn.username);
      setActor(signedIn);
      setTrusted(remember);
      setStatus('active');
      return { ok: true, actor: signedIn };
    },
    [services],
  );

  const value = useMemo<AuthValue>(
    () => ({
      actor,
      status,
      trusted,
      loginWithPassword,
      logout,
      ready,
      lastUsername,
    }),
    [actor, status, trusted, loginWithPassword, logout, ready, lastUsername],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within an AuthProvider.');
  return value;
}
