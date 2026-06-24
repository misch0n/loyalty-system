import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Services } from '../../../../services/Services';
import type { Actor } from '../../../../services/types';
import { ServicesProvider } from '../../../common/ServicesContext';
import { AuthProvider } from '../../../app/AuthContext';
import { LogoGesturesProvider } from '../../../app/LogoGestures';
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
      currentSessionEpoch: vi.fn().mockResolvedValue(1),
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
    await mount(makeServices(vi.fn().mockResolvedValue({ ok: true, actor: STAFF })));
    expect(container.querySelector('.staff-login .mark')).not.toBeNull();
    expect(container.textContent).toContain('Staff sign-in');
    expect(container.querySelector('input[autocomplete="username"]')).not.toBeNull();
    expect(container.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
    // PIN is only for unlock now — no keypad on the sign-in screen.
    expect(container.querySelector('.keypad')).toBeNull();
  });

  it('wrong password shows an error and keeps the form usable', async () => {
    const login = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'Wrong username or password.' })
      .mockResolvedValueOnce({ ok: true, actor: STAFF });
    await mount(makeServices(login));

    await signIn('sam', 'nope');
    expect(container.querySelector('.staff-login__error')?.textContent).toContain('Wrong');

    await signIn('sam', 'staff');
    expect(container.textContent).toContain('STAFF PANEL HOME');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('correct staff credentials route to the counter', async () => {
    await mount(makeServices(vi.fn().mockResolvedValue({ ok: true, actor: STAFF })));
    await signIn('sam', 'staff');
    expect(container.textContent).toContain('STAFF PANEL HOME');
  });

  it('an admin signing in routes to the counter (admin panel reached from there)', async () => {
    await mount(makeServices(vi.fn().mockResolvedValue({ ok: true, actor: ADMIN })));
    await signIn('admin', 'admin');
    expect(container.textContent).toContain('STAFF PANEL HOME');
  });
});
