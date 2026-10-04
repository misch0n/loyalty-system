/**
 * Unit tests for the pure staff/admin session logic (UX-SPEC §6).
 * Synthetic data only; no React, no real storage.
 */

import { describe, it, expect } from 'vitest';
import {
  actorFrom,
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
      parseSession(JSON.stringify({ actorId: 'a', username: 'b', role: 'staff' })),
    ).toBeNull();
  });

  it('accepts an idle-lock-era blob and drops its lastActivity', () => {
    const legacy = { ...makeSession(), lastActivity: 1_000_000 };
    expect(parseSession(JSON.stringify(legacy))).toEqual(makeSession());
  });

  it('returns null when a field has the wrong type', () => {
    expect(
      parseSession(
        JSON.stringify({
          actorId: 'a',
          username: 'b',
          role: 'staff',
          epoch: '1',
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
  it('projects the UI actor', () => {
    const session = makeSession();
    expect(actorFrom(session)).toEqual({
      id: 'actor-1',
      username: 'Sam',
      role: 'staff',
    });
  });
});

describe('reconcile', () => {
  const serverEpoch = 5;

  it('reconciles a null session to anon', () => {
    expect(reconcile(null, serverEpoch)).toEqual({
      status: 'anon',
      actor: null,
      session: null,
    });
  });

  it('equal epoch → active (identity restored)', () => {
    const session = makeSession({ epoch: 5 });
    const out = reconcile(session, serverEpoch);
    expect(out.status).toBe('active');
    expect(out.session).toEqual(session);
    expect(out.actor).toEqual(actorFrom(session));
  });

  it('revoked (stored epoch < server) → anon', () => {
    const session = makeSession({ epoch: 4 });
    expect(reconcile(session, serverEpoch)).toEqual({ status: 'anon', actor: null, session: null });
  });
});
