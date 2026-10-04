import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Services } from '../../../../services/Services';
import type { Actor } from '../../../../services/types';
import { ServicesProvider } from '../../../common/ServicesContext';
import { AuthProvider } from '../../../app/AuthContext';
import { LogoGesturesProvider } from '../../../app/LogoGestures';
import { ToastProvider } from '../../../components/Toast/Toast';
import { ApiError } from '../../../../services/errors';
import { Panel } from './Panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_KEY = 'cafe-loyalty.staffSession';
const STAFFER: Actor = { id: 's1', username: 'Sam', role: 'staff' };

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

function fakeServices(auditRows?: unknown[]): Services {
  const rows = auditRows ?? [
    { id: 'a1', actorId: 's1', actorRole: 'staff', action: 'loyalty.accrue', targetId: 'c1', details: '2', timestamp: new Date().toISOString() },
    { id: 'a2', actorId: 's1', actorRole: 'staff', action: 'loyalty.redeem', targetId: 'c2', timestamp: new Date().toISOString() },
  ];
  return {
    staff: {
      list: vi.fn().mockResolvedValue([
        { id: 's1', username: 'Sam', role: 'staff', active: true, createdAt: '2026-01-01T00:00:00Z' },
      ]),
      session: vi.fn().mockResolvedValue({ status: 'active', actor: STAFFER, epoch: 1, remembered: false }),
      logout: vi.fn().mockResolvedValue(undefined),
    },
    audit: {
      // The Panel scopes its query to the signed-in actor; honour that here so
      // the assertion on the filter is meaningful.
      list: vi.fn().mockResolvedValue(rows),
    },
    customers: {
      getById: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === 'c1' ? { id: 'c1', displayName: 'Maria' } : { id: 'c2', displayName: 'Tom' }),
      ),
    },
    sync: { observable: { onMutate: vi.fn().mockReturnValue(() => {}) } },
  } as unknown as Services;
}

function seedSession() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      actorId: STAFFER.id,
      username: STAFFER.username,
      role: STAFFER.role,
      epoch: 1,
    }),
  );
}

async function mountPanel(injected?: Services) {
  seedSession();
  const services = injected ?? fakeServices();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/staff']}>
        <ServicesProvider value={services}>
          <ToastProvider>
            <AuthProvider>
              <LogoGesturesProvider value={{}}>
                <Routes>
                  <Route path="/staff" element={<Panel />} />
                  <Route path="/staff/scan" element={<div>SCAN ROUTE</div>} />
                  <Route path="/login" element={<div>LOGIN ROUTE</div>} />
                </Routes>
              </LogoGesturesProvider>
            </AuthProvider>
          </ToastProvider>
        </ServicesProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Staff Panel', () => {
  it('renders the on-shift name, scan button and recent feed', async () => {
    await mountPanel();
    expect(container.querySelector('.topbar')).not.toBeNull();
    expect(container.querySelector('.onshift')?.textContent).toContain('Sam');
    const scan = Array.from(container.querySelectorAll('button.btn-forest')).find((b) =>
      b.textContent?.includes('Scan'),
    );
    expect(scan).toBeDefined();
    // Feed resolved to target names + add/red rows.
    expect(container.querySelectorAll('.feed .row').length).toBe(2);
    expect(container.querySelector('.feed')?.textContent).toContain('Maria');
    expect(container.querySelector('.row.red')).not.toBeNull();
  });

  it('scopes the recent list to the signed-in actor and the last hour', async () => {
    const now = Date.now();
    const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
    const services = fakeServices([
      { id: 'fresh', actorId: 's1', actorRole: 'staff', action: 'loyalty.accrue', targetId: 'c1', details: '1', timestamp: hoursAgo(0) },
      { id: 'stale', actorId: 's1', actorRole: 'staff', action: 'loyalty.accrue', targetId: 'c2', details: '1', timestamp: hoursAgo(3) },
    ]);
    await mountPanel(services);

    // The audit query is filtered by actor — a staffer never sees a colleague's work.
    expect(services.audit.list).toHaveBeenCalledWith({ actorId: 's1' });
    // …and the 3-hour-old row is outside the one-hour window.
    expect(container.querySelectorAll('.feed .row').length).toBe(1);
    expect(container.querySelector('.section-h')?.textContent).toBe('Your last hour');
  });

  it('caps the recent list at 10 rows with no pager and no "Load all"', async () => {
    const services = fakeServices(
      Array.from({ length: 25 }, (_, i) => ({
        id: `r${i}`,
        actorId: 's1',
        actorRole: 'staff',
        action: 'loyalty.accrue',
        targetId: 'c1',
        details: '1',
        timestamp: new Date().toISOString(),
      })),
    );
    await mountPanel(services);

    expect(container.querySelectorAll('.feed .row').length).toBe(10);
    // The bound IS the safeguard — there is deliberately no way to widen it.
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons.some((t) => /load more|load all/i.test(t ?? ''))).toBe(false);
  });

  it('Scan button navigates to the scan workflow', async () => {
    await mountPanel();
    const scan = Array.from(container.querySelectorAll('button.btn-forest')).find((b) =>
      b.textContent?.includes('Scan'),
    ) as HTMLButtonElement;
    await act(async () => {
      scan.click();
    });
    expect(container.textContent).toContain('SCAN ROUTE');
  });

  it('"End shift" ends the server session as well as the local one', async () => {
    const services = fakeServices();
    await mountPanel(services);
    const signOut = container.querySelector('.staff-panel__signout') as HTMLButtonElement;
    await act(async () => {
      signOut.click();
    });
    expect(services.staff.logout).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(container.textContent).toContain('LOGIN ROUTE');
  });

  it('says the list failed to load — not that the hour was empty — and retries', async () => {
    const services = fakeServices();
    const list = services.audit.list as ReturnType<typeof vi.fn>;
    const rows = await list();
    list.mockReset();
    list.mockRejectedValueOnce(new ApiError({ kind: 'offline' })).mockResolvedValue(rows);
    await mountPanel(services);

    expect(container.textContent).not.toContain('Nothing in the last hour');
    expect(container.querySelector('.staff-panel__error')?.textContent).toContain(
      'Couldn’t reach the server',
    );
    expect(container.querySelector('.feed')).toBeNull();

    const retry = container.querySelector('.staff-panel__retry') as HTMLButtonElement;
    expect(retry.textContent).toBe('Try again');
    await act(async () => {
      retry.click();
    });
    await act(async () => {
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });

    expect(list).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.staff-panel__error')).toBeNull();
    expect(container.querySelectorAll('.feed .row').length).toBe(2);
  });

  it('keeps the list when one customer name cannot be fetched', async () => {
    const services = fakeServices();
    (services.customers.getById as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      id === 'c1'
        ? Promise.resolve({ id: 'c1', displayName: 'Maria' })
        : Promise.reject(new ApiError({ kind: 'server', status: 500 })),
    );
    await mountPanel(services);

    const rows = Array.from(container.querySelectorAll('.feed .row')).map((r) => r.textContent);
    expect(rows.length).toBe(2);
    expect(rows.some((t) => t?.includes('Maria'))).toBe(true);
    expect(rows.some((t) => t?.includes('a customer'))).toBe(true);
    expect(container.querySelector('.staff-panel__error')).toBeNull();
  });
});
