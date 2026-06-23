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

const ACTOR: Actor = { id: 's1', username: 'Sam', role: 'staff' };

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

function makeServices(loginWithPin: ReturnType<typeof vi.fn>): Services {
  return {
    staff: {
      loginWithPin,
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

function keypad(): Map<string, HTMLButtonElement> {
  const map = new Map<string, HTMLButtonElement>();
  container.querySelectorAll<HTMLButtonElement>('.keypad .key[data-k]').forEach((b) => {
    map.set(b.dataset.k ?? '', b);
  });
  return map;
}

async function typePin(digits: string) {
  const keys = keypad();
  for (const d of digits) {
    await act(async () => {
      keys.get(d)?.click();
    });
  }
  // settle the async verify
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Staff Login', () => {
  it('renders the donor lockup + title + PIN pad', async () => {
    await mount(makeServices(vi.fn().mockResolvedValue({ ok: true, actor: ACTOR })));
    expect(container.querySelector('.staff-login .mark')).not.toBeNull();
    expect(container.textContent).toContain('Staff sign-in');
    expect(container.querySelector('.pin-dots')).not.toBeNull();
    expect(container.querySelector('.keypad')).not.toBeNull();
  });

  it('wrong PIN clears the pad, re-enables it (no freeze) and shows an error', async () => {
    const loginWithPin = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'nope' })
      .mockResolvedValueOnce({ ok: true, actor: ACTOR });
    await mount(makeServices(loginWithPin));

    await typePin('0000');
    // Error shown, dots reset, pad NOT disabled (the keys are clickable again).
    expect(container.querySelector('.staff-login__error')?.textContent).toContain('match');
    expect(container.querySelectorAll('.pin-dots i.on').length).toBe(0);
    const firstKey = keypad().get('1');
    expect(firstKey?.disabled).toBe(false);

    // Correct PIN now navigates to the staff panel.
    await typePin('1234');
    expect(container.textContent).toContain('STAFF PANEL HOME');
    expect(loginWithPin).toHaveBeenCalledTimes(2);
  });

  it('correct PIN navigates straight to the staff panel', async () => {
    await mount(makeServices(vi.fn().mockResolvedValue({ ok: true, actor: ACTOR })));
    await typePin('1234');
    expect(container.textContent).toContain('STAFF PANEL HOME');
  });
});
