import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Services } from '../../../../services/Services';
import type { Actor } from '../../../../services/types';
import { ServicesProvider } from '../../../common/ServicesContext';
import { AuthProvider } from '../../../app/AuthContext';
import { LogoGesturesProvider } from '../../../app/LogoGestures';
import { ApiError } from '../../../../services/errors';
import { Login } from './Login';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAFF: Actor = { id: 's1', username: 'sam', name: 'Sam', role: 'staff' };
const ADMIN: Actor = { id: 'a1', username: 'admin', name: 'Manager', role: 'admin' };

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

function makeServices(login: ReturnType<typeof vi.fn>): Services {
  return {
    staff: {
      login,
      session: vi.fn().mockResolvedValue({ status: 'anon', epoch: 1 }),
    },
  } as unknown as Services;
}

async function mount(services: Services) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/login']}>
        <ServicesProvider value={services}>
          <AuthProvider>
            <LogoGesturesProvider value={{}}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/staff" element={<div>STAFF PANEL HOME</div>} />
                <Route path="/admin" element={<div>ADMIN HOME</div>} />
              </Routes>
            </LogoGesturesProvider>
          </AuthProvider>
        </ServicesProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function setValue(selector: string, value: string) {
  const el = container.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function signIn(username: string, password: string) {
  await act(async () => {
    setValue('input[autocomplete="username"]', username);
    setValue('input[autocomplete="current-password"]', password);
  });
  await act(async () => {
    container.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  // settle the async login
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Staff Login', () => {
  it('renders the lockup + title + username/password form (no PIN pad)', async () => {
    await mount(makeServices(vi.fn().mockResolvedValue({ ok: true, actor: STAFF, epoch: 1 })));
    expect(container.querySelector('.staff-login .mark')).not.toBeNull();
    expect(container.textContent).toContain('Staff sign-in');
    expect(container.querySelector('input[autocomplete="username"]')).not.toBeNull();
    expect(container.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
    // There is no PIN anywhere (S1) — no keypad on the sign-in screen.
    expect(container.querySelector('.keypad')).toBeNull();
  });

  it('wrong password shows an error and keeps the form usable', async () => {
    const login = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'Wrong username or password.' })
      .mockResolvedValueOnce({ ok: true, actor: STAFF, epoch: 1 });
    await mount(makeServices(login));

    await signIn('sam', 'nope');
    expect(container.querySelector('.staff-login__error')?.textContent).toContain('Wrong');

    await signIn('sam', 'staff');
    expect(container.textContent).toContain('STAFF PANEL HOME');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('correct staff credentials route to the counter', async () => {
    const services = makeServices(vi.fn().mockResolvedValue({ ok: true, actor: STAFF, epoch: 1 }));
    await mount(services);
    await signIn('sam', 'staff');
    expect(container.textContent).toContain('STAFF PANEL HOME');
    // The login answer carries the epoch — no second request that could fail
    // after the session cookie was set.
    expect(services.staff.session).not.toHaveBeenCalled();
  });

  it('an admin signing in routes to the counter (admin panel reached from there)', async () => {
    await mount(makeServices(vi.fn().mockResolvedValue({ ok: true, actor: ADMIN, epoch: 1 })));
    await signIn('admin', 'admin');
    expect(container.textContent).toContain('STAFF PANEL HOME');
  });

  it('counts a rate-limited sign-in down on the button, then lets it try again', async () => {
    vi.useFakeTimers();
    try {
      const login = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: 'Too many sign-in attempts. Wait for the countdown, then try again.',
          retryAfterSec: 75,
        })
        .mockResolvedValueOnce({ ok: true, actor: STAFF, epoch: 1 });
      await mount(makeServices(login));

      await signIn('sam', 'staff');
      const error = container.querySelector('.staff-login__error')?.textContent;
      expect(error).toBe('Too many sign-in attempts. Wait for the countdown, then try again.');
      expect(submitButton().disabled).toBe(true);
      expect(submitButton().textContent).toBe('Try again in 1:15');

      // Submitting during the wait sends nothing.
      await signIn('sam', 'staff');
      expect(login).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(submitButton().textContent).toBe('Try again in 15 s');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(submitButton().disabled).toBe(false);
      expect(submitButton().textContent).toBe('Sign in');
      // The sentence goes with the countdown.
      expect(container.querySelector('.staff-login__error')).toBeNull();

      await signIn('sam', 'staff');
      expect(login).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('STAFF PANEL HOME');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits a default spell when the server gave no figure', async () => {
    vi.useFakeTimers();
    try {
      const login = vi.fn().mockResolvedValue({
        ok: false,
        reason: 'Too many sign-in attempts. Wait for the countdown, then try again.',
        retryAfterSec: null,
      });
      await mount(makeServices(login));
      await signIn('sam', 'staff');
      expect(submitButton().textContent).toBe('Try again in 30 s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells an unreachable server apart from a failing one', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ kind: 'offline' }))
      .mockRejectedValueOnce(new ApiError({ kind: 'server', status: 500 }))
      .mockRejectedValueOnce(new TypeError('boom'));
    await mount(makeServices(login));

    await signIn('sam', 'staff');
    expect(container.querySelector('.staff-login__error')?.textContent).toContain(
      'Couldn’t reach the server',
    );

    await signIn('sam', 'staff');
    expect(container.querySelector('.staff-login__error')?.textContent).toContain(
      'The server had a problem',
    );

    await signIn('sam', 'staff');
    expect(container.querySelector('.staff-login__error')?.textContent).toBe(
      'Couldn’t sign in. Try again.',
    );
    // None of these is a countdown.
    expect(submitButton().disabled).toBe(false);
  });
});

function submitButton(): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}
