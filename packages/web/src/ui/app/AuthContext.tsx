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
 * Boot resolution (register X1, decisions in `session.ts` `reconcile`): when a
 * signed-in session is persisted, ask the server — `GET /auth/session`, through
 * `StaffService.session()` — before `ready` flips true:
 *   - server says signed out                   → clear → 'anon'
 *   - server says signed in                    → 'active' as the server's
 *                                                account; blob refreshed
 *   - server unreachable                       → 'active' from the blob; the
 *                                                connectivity banner says so
 * So a session the server ended while the page was closed (TTL, sign-out
 * elsewhere, account disabled or deleted, "Sign out all devices") is known at
 * load, not at the first failing request. With nothing persisted no request is
 * made — a customer's phone never asks. A session that ends *while the page is
 * open* is still caught by the first call it makes: a `signed_out` failure,
 * which `ConnectionWatch` turns into a `logout()`.
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
  ): Promise<{ ok: boolean; actor?: Actor; reason?: string; retryAfterSec?: number | null }>;
  /**
   * The last username that signed in on this device (no credential stored).
   * Used to prefill the sign-in form so a returning, non-remembered device asks
   * for the last user's password rather than a blank form.
   */
  lastUsername: string | null;
  /** Full sign-out: ends the server session and clears actor and device trust. */
  logout(): void;
  /**
   * False until the boot reconciliation (`GET /auth/session`) has settled.
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

  // Bumped by every sign-in and sign-out, so a boot check still in flight when
  // the user acts cannot land afterwards and overwrite what they just did.
  const generation = useRef(0);

  const logout = useCallback(() => {
    generation.current += 1;
    clearStorage();
    applyAnon();
    // Best-effort: the route succeeds with no session at all, and a device that
    // cannot reach the server is signed out locally either way.
    void services.staff.logout().catch(() => undefined);
  }, [services, applyAnon]);

  // Boot: restore, then reconcile against what the server says (X1). `ready`
  // stays false until this settles — EntryResolver and the guards wait on it.
  useEffect(() => {
    let cancelled = false;
    const restored = readPersisted();
    const bootGeneration = generation.current;
    if (!restored) {
      applyAnon();
      setReady(true);
      return;
    }
    void services.staff
      .session()
      // Any failure to ask — offline, the server down, an answer that was not
      // the API's — is "unknown", not "signed out" (register X2).
      .catch(() => null)
      .then((answer) => {
        if (cancelled || generation.current !== bootGeneration) return;
        const outcome = reconcile(restored.session, answer);
        if (outcome.status === 'anon' || !outcome.session) {
          clearStorage();
          applyAnon();
          return;
        }
        const isTrusted = outcome.trusted ?? restored.trusted;
        // The server answered: keep the blob true to it (name, role, and where
        // a remembered login lives).
        if (outcome.trusted !== null) persist(outcome.session, isTrusted);
        setActor(outcome.actor);
        setTrusted(isTrusted);
        setStatus(outcome.status);
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
    ): Promise<{ ok: boolean; actor?: Actor; reason?: string; retryAfterSec?: number | null }> => {
      const result = await services.staff.login(username, password, remember);
      if (!result.ok || !result.actor || result.epoch === undefined) {
        return { ok: false, reason: result.reason, retryAfterSec: result.retryAfterSec };
      }
      generation.current += 1;
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
