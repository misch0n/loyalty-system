/**
 * Regression tests for the staff PIN sign-in (StaffLogin).
 *
 * The bug: the auto-submit effect listed `verifying` in its deps AND set it
 * inside the effect, so reaching the 4th digit re-ran the effect, whose cleanup
 * cancelled the in-flight verify — leaving `verifying` stuck true. The pad ended
 * up permanently disabled: frozen, undeletable, and a correct PIN did nothing.
 *
 * These mount the real StaffLogin + AuthProvider against a fake services object
 * (no IndexedDB / PeerJS), drive the pad, and assert the pad recovers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../../../src/ui/common/ServicesContext';
import { AuthProvider } from '../../../src/ui/app/AuthContext';
import { StaffLogin } from '../../../src/ui/screens/staff/StaffLogin';
import type { Services } from '../../../src/services/Services';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function fakeServices(loginResult: { ok: boolean; actor?: unknown; reason?: string }): Services {
  return {
    staff: {
      loginWithPin: vi.fn(async () => loginResult),
      currentSessionEpoch: vi.fn(async () => 0),
    },
  } as unknown as Services;
}

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
}

function key(digit: string): HTMLButtonElement {
  const btn = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button.kit-pinpad__key'),
  ).find((b) => b.textContent === digit);
  if (!btn) throw new Error(`PIN key "${digit}" not found`);
  return btn;
}

async function type(pin: string) {
  for (const d of pin) {
    await act(async () => {
      key(d).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
  // Let the async verify settle (loginWithPin + currentSessionEpoch microtasks).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StaffLogin PIN pad', () => {
  it('re-enables the pad and shows an error after a wrong PIN (no freeze)', async () => {
    await mount(
      <ServicesProvider value={fakeServices({ ok: false, reason: 'nope' })}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <StaffLogin />
          </MemoryRouter>
        </AuthProvider>
      </ServicesProvider>,
    );

    await type('9999');

    // The pad must not be stuck disabled.
    const anyKey = container.querySelector<HTMLButtonElement>('button.kit-pinpad__key');
    expect(anyKey?.disabled).toBe(false);
    // Entry was cleared, ready for another attempt.
    expect(container.querySelectorAll('.kit-pinpad__dot--on').length).toBe(0);
    // Instructive error shown.
    expect(container.querySelector('.kit-pinpad__error')?.textContent ?? '').toMatch(
      /didn.t match/i,
    );
  });

  it('lets you delete a digit after typing (pad stays interactive)', async () => {
    await mount(
      <ServicesProvider value={fakeServices({ ok: false })}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <StaffLogin />
          </MemoryRouter>
        </AuthProvider>
      </ServicesProvider>,
    );

    await act(async () => {
      key('1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      key('2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelectorAll('.kit-pinpad__dot--on').length).toBe(2);

    const del = container.querySelector<HTMLButtonElement>('.kit-pinpad__key--del')!;
    expect(del.disabled).toBe(false);
    await act(async () => {
      del.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelectorAll('.kit-pinpad__dot--on').length).toBe(1);
  });

  it('navigates to the staff panel on a correct PIN', async () => {
    await mount(
      <ServicesProvider
        value={fakeServices({ ok: true, actor: { id: 's1', username: 'Sam', role: 'staff' } })}
      >
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<StaffLogin />} />
              <Route path="/staff" element={<div>STAFF PANEL</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ServicesProvider>,
    );

    await type('1234');

    expect(container.textContent).toContain('STAFF PANEL');
  });
});
