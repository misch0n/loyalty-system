/**
 * Unit tests for the pure staff/admin session logic (UX-SPEC §6).
 * Synthetic data only; no React, no real storage.
 */

import { describe, it, expect } from 'vitest';
import {
  INACTIVITY_MS,
  actorFrom,
  isIdle,
  parseSession,
  reconcile,
  type PersistedSession,
} from '../../../src/ui/app/session';

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    actorId: 'actor-1',
    username: 'Sam',
    role: 'staff',
    epoch: 5,
    lastActivity: 1_000_000,
    ...overrides,
  };
}

describe('parseSession', () => {
  it('returns null for null / empty input', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession('')).toBeNull();
  });

  it('returns null for non-JSON garbage', () => {
    expect(parseSession('not json {')).toBeNull();
    expect(parseSession('}{')).toBeNull();
  });

  it('returns null for JSON that is not an object', () => {
    expect(parseSession('42')).toBeNull();
    expect(parseSession('"a string"')).toBeNull();
    expect(parseSession('null')).toBeNull();
    expect(parseSession('[1,2,3]')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseSession(JSON.stringify({ actorId: 'a' }))).toBeNull();
    expect(
      parseSession(
        JSON.stringify({ actorId: 'a', username: 'b', role: 'staff', epoch: 1 }),
      ),
    ).toBeNull();
  });

  it('returns null when a field has the wrong type', () => {
    expect(
      parseSession(
        JSON.stringify({
          actorId: 'a',
          username: 'b',
          role: 'staff',
          epoch: '1',
          lastActivity: 2,
        }),
      ),
    ).toBeNull();
  });

  it('returns null for an unknown role', () => {
    expect(
      parseSession(
        JSON.stringify({
          actorId: 'a',
          username: 'b',
          role: 'customer',
          epoch: 1,
          lastActivity: 2,
        }),
      ),
    ).toBeNull();
  });

  it('accepts a valid staff session', () => {
    const session = makeSession();
    expect(parseSession(JSON.stringify(session))).toEqual(session);
  });

  it('accepts a valid admin session', () => {
    const session = makeSession({ role: 'admin' });
    expect(parseSession(JSON.stringify(session))).toEqual(session);
  });
});

describe('actorFrom', () => {
  it('projects the audit/UI actor and drops timeout fields', () => {
    const session = makeSession();
    expect(actorFrom(session)).toEqual({
      id: 'actor-1',
      username: 'Sam',
      role: 'staff',
    });
  });
});

describe('isIdle', () => {
  it('is false within the window', () => {
    const session = makeSession({ lastActivity: 0 });
    expect(isIdle(session, INACTIVITY_MS)).toBe(false);
  });

  it('is false at exactly the window boundary (strict >)', () => {
    const session = makeSession({ lastActivity: 0 });
    expect(isIdle(session, INACTIVITY_MS)).toBe(false);
  });

  it('is true just past the window', () => {
    const session = makeSession({ lastActivity: 0 });
    expect(isIdle(session, INACTIVITY_MS + 1)).toBe(true);
  });
});

describe('reconcile', () => {
  const serverEpoch = 5;

  it('reconciles a null session to anon', () => {
    expect(reconcile(null, serverEpoch, 0, true)).toEqual({
      status: 'anon',
      actor: null,
      session: null,
    });
  });

  it('fresh, equal epoch → active (identity restored)', () => {
    const session = makeSession({ epoch: 5, lastActivity: 1000 });
    const out = reconcile(session, serverEpoch, 1000, true);
    expect(out.status).toBe('active');
    expect(out.session).toEqual(session);
    expect(out.actor).toEqual(actorFrom(session));
  });

  it('revoked (stored epoch < server) → anon, even if fresh', () => {
    const session = makeSession({ epoch: 4, lastActivity: 1000 });
    const out = reconcile(session, serverEpoch, 1000, true);
    expect(out).toEqual({ status: 'anon', actor: null, session: null });
  });

  it('idle + trusted → locked, identity kept', () => {
    const session = makeSession({ epoch: 5, lastActivity: 0 });
    const out = reconcile(session, serverEpoch, INACTIVITY_MS + 1, true);
    expect(out.status).toBe('locked');
    expect(out.session).toEqual(session);
    expect(out.actor).toEqual(actorFrom(session));
  });

  it('idle + ephemeral → anon (cleared)', () => {
    const session = makeSession({ epoch: 5, lastActivity: 0 });
    const out = reconcile(session, serverEpoch, INACTIVITY_MS + 1, false);
    expect(out).toEqual({ status: 'anon', actor: null, session: null });
  });

  it('at exactly INACTIVITY_MS → still active (not idle)', () => {
    const session = makeSession({ epoch: 5, lastActivity: 0 });
    const out = reconcile(session, serverEpoch, INACTIVITY_MS, true);
    expect(out.status).toBe('active');
    expect(out.session).toEqual(session);
  });

  it('revocation takes precedence over idle', () => {
    const session = makeSession({ epoch: 4, lastActivity: 0 });
    const out = reconcile(session, serverEpoch, INACTIVITY_MS + 1, true);
    expect(out).toEqual({ status: 'anon', actor: null, session: null });
  });
});
