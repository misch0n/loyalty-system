/**
 * AuthContext's boot reconcile against `GET /auth/session` (register X1).
 * Stubbed at the services level (`vi.fn()` via `ServicesProvider`) — no store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Services } from '../../services/Services';
import type { StaffSession } from '../../services/StaffService';
import { ApiError } from '../../services/errors';
import { ServicesProvider } from '../common/ServicesContext';
import { AuthProvider, useAuth } from './AuthContext';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEVICE_KEY = 'cafe-loyalty.staffDevice';
const SESSION_KEY = 'cafe-loyalty.staffSession';

const PERSISTED = { actorId: 's1', username: 'sam', name: 'Sam', role: 'staff', epoch: 1 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;

function Probe() {
  const value = useAuth();
  auth = value;
  const { ready, status, actor, trusted } = value;
  return (
    <output>
      {JSON.stringify({ ready, status, name: actor?.name ?? null, role: actor?.role ?? null, trusted })}
    </output>
  );
}

function read(): { ready: boolean; status: string; name: string | null; role: string | null; trusted: boolean } {
  return JSON.parse(container.querySelector('output')?.textContent ?? '{}');
}

function servicesWith(session: () => Promise<StaffSession>): Services {
  return {
    staff: { session: vi.fn(session), logout: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Services;
}

async function mount(services: Services) {
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </ServicesProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AuthContext boot reconcile', () => {
  it('asks nothing when no session is persisted', async () => {
    const services = servicesWith(() => Promise.resolve({ status: 'anon', epoch: 0 }));
    await mount(services);
    expect(services.staff.session).not.toHaveBeenCalled();
    expect(read()).toMatchObject({ ready: true, status: 'anon' });
  });

  it('signs out at load when the server ended the session while the page was closed', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(PERSISTED));
    const services = servicesWith(() => Promise.resolve({ status: 'anon', epoch: 2 }));
    await mount(services);
    expect(services.staff.session).toHaveBeenCalledTimes(1);
    expect(read()).toMatchObject({ ready: true, status: 'anon', name: null });
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(DEVICE_KEY)).toBeNull();
  });

  it('stays signed in as the server’s account, and refreshes the stored copy', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(PERSISTED));
    const services = servicesWith(() =>
      Promise.resolve({
        status: 'active',
        actor: { id: 's1', username: 'sam', name: 'Samira', role: 'admin' },
        epoch: 3,
        remembered: true,
      }),
    );
    await mount(services);
    expect(read()).toEqual({ ready: true, status: 'active', name: 'Samira', role: 'admin', trusted: true });
    // A remembered login lives in localStorage, whatever the stale blob said.
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null')).toMatchObject({
      actorId: 's1',
      name: 'Samira',
      role: 'admin',
      epoch: 3,
    });
  });

  it('keeps the persisted session when the server cannot be reached', async () => {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(PERSISTED));
    const services = servicesWith(() => Promise.reject(new ApiError({ kind: 'offline' })));
    await mount(services);
    expect(read()).toEqual({ ready: true, status: 'active', name: 'Sam', role: 'staff', trusted: true });
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null')).toEqual(PERSISTED);
  });

  it('is not ready until the server has answered', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(PERSISTED));
    let answer: (value: StaffSession) => void = () => undefined;
    const services = servicesWith(
      () =>
        new Promise<StaffSession>((resolve) => {
          answer = resolve;
        }),
    );
    await mount(services);
    expect(read()).toMatchObject({ ready: false, status: 'anon' });

    await act(async () => {
      answer({ status: 'anon', epoch: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(read()).toMatchObject({ ready: true, status: 'anon' });
  });

  it('a sign-in made while the boot check is in flight is not overwritten by its answer', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(PERSISTED));
    let answer: (value: StaffSession) => void = () => undefined;
    const services = servicesWith(
      () =>
        new Promise<StaffSession>((resolve) => {
          answer = resolve;
        }),
    );
    (services.staff as unknown as { login: unknown }).login = vi.fn().mockResolvedValue({
      ok: true,
      actor: { id: 'a9', username: 'ana', name: 'Ana', role: 'admin' },
      epoch: 5,
    });
    await mount(services);

    await act(async () => {
      await auth!.loginWithPassword('ana', 'pw', false);
    });
    expect(read()).toMatchObject({ status: 'active', name: 'Ana' });

    // The stale boot answer lands after the sign-in: it must change nothing.
    await act(async () => {
      answer({ status: 'anon', epoch: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(read()).toMatchObject({ ready: true, status: 'active', name: 'Ana' });
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')).toMatchObject({ actorId: 'a9' });
  });
});
