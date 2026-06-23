import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Services } from '../../../../services/Services';
import type { Actor } from '../../../../services/types';
import { ServicesProvider } from '../../../common/ServicesContext';
import { AuthProvider } from '../../../app/AuthContext';
import { LogoGesturesProvider } from '../../../app/LogoGestures';
import { PairingProvider } from '../../../common/PairingContext';
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

function fakeServices(): Services {
  return {
    staff: {
      list: vi.fn().mockResolvedValue([
        { id: 's1', username: 'Sam', role: 'staff', active: true, createdAt: '2026-01-01T00:00:00Z' },
      ]),
      currentSessionEpoch: vi.fn().mockResolvedValue(1),
    },
    audit: {
      list: vi.fn().mockResolvedValue([
        { id: 'a1', actorId: 's1', actorRole: 'staff', action: 'loyalty.accrue', targetId: 'c1', details: '2', timestamp: new Date().toISOString() },
        { id: 'a2', actorId: 's1', actorRole: 'staff', action: 'loyalty.redeem', targetId: 'c2', timestamp: new Date().toISOString() },
      ]),
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
      lastActivity: Date.now(),
    }),
  );
}

async function mountPanel() {
  seedSession();
  const services = fakeServices();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/staff']}>
        <ServicesProvider value={services}>
          <AuthProvider>
            <PairingProvider>
              <LogoGesturesProvider value={{}}>
                <Routes>
                  <Route path="/staff" element={<Panel />} />
                  <Route path="/staff/scan" element={<div>SCAN ROUTE</div>} />
                  <Route path="/login" element={<div>LOGIN ROUTE</div>} />
                </Routes>
              </LogoGesturesProvider>
            </PairingProvider>
          </AuthProvider>
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
});
