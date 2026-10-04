import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Services } from '../../../../services/Services';
import type { Actor } from '../../../../services/types';
import { ServicesProvider } from '../../../common/ServicesContext';
import { AuthProvider } from '../../../app/AuthContext';
import { LogoGesturesProvider } from '../../../app/LogoGestures';
import { ToastProvider } from '../../../components/Toast/Toast';
import { StatWide } from '../_parts/Stat/Stat';
import { FeedRow } from '../_parts/FeedRow/FeedRow';
import { Alert } from '../_parts/Alert/Alert';
import { Admin } from './Admin';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_KEY = 'cafe-loyalty.staffSession';

const ADMIN: Actor = { id: 'a1', username: 'sam', role: 'admin' };
const STAFFER: Actor = { id: 's1', username: 'aya', role: 'staff' };

function fakeServices(role: 'admin' | 'staff'): Services {
  const actor = role === 'admin' ? ADMIN : STAFFER;
  const staffList = [
    { id: 'a1', username: 'sam', role: 'admin', active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 's1', username: 'aya', role: 'staff', active: true, createdAt: '2026-01-01T00:00:00Z' },
  ];
  return {
    loyalty: {
      getAlerts: vi.fn().mockResolvedValue([
        {
          kind: 'self-dealing',
          staffId: 's1',
          staffName: 'aya',
          customerId: 'c1',
          at: new Date().toISOString(),
          detail: 'Credited then redeemed on the same card within 30s, 3 times (limit 3).',
        },
      ]),
    },
    audit: {
      list: vi.fn().mockImplementation(({ action }: { action?: string } = {}) => {
        if (action === 'loyalty.accrue') {
          return Promise.resolve([
            { id: 'x1', actorId: 'a1', actorRole: 'admin', action: 'loyalty.accrue', timestamp: new Date().toISOString() },
          ]);
        }
        return Promise.resolve([
          { id: 'l1', actorId: 'a1', actorRole: 'admin', action: 'loyalty.accrue', timestamp: new Date().toISOString() },
        ]);
      }),
    },
    config: {
      get: vi.fn().mockResolvedValue({
        pointsPerReward: 10,
        rewardDescription: 'Free coffee',
        pointsPerPurchase: 1,
        maxPointsPerTransaction: 3,
        cardInactivityDays: 90,
      }),
      update: vi.fn().mockResolvedValue({
        pointsPerReward: 10,
        rewardDescription: 'Free coffee',
        pointsPerPurchase: 1,
        maxPointsPerTransaction: 3,
        cardInactivityDays: 90,
      }),
    },
    staff: {
      list: vi.fn().mockResolvedValue(staffList),
      currentSessionEpoch: vi.fn().mockResolvedValue(1),
      logout: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ ...actor, active: true, createdAt: '' }),
      revokeAllSessions: vi.fn().mockResolvedValue(2),
    },
  } as unknown as Services;
}

function seedSession(role: 'admin' | 'staff') {
  const actor = role === 'admin' ? ADMIN : STAFFER;
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      actorId: actor.id,
      username: actor.username,
      role: actor.role,
      epoch: 1,
    }),
  );
}

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

async function mountAdmin(role: 'admin' | 'staff'): Promise<Services> {
  seedSession(role);
  const services = fakeServices(role);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/admin']}>
        <ServicesProvider value={services}>
          <AuthProvider>
            <LogoGesturesProvider value={{}}>
              <ToastProvider>
                <Routes>
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/login" element={<p className="at-login">sign-in</p>} />
                </Routes>
              </ToastProvider>
            </LogoGesturesProvider>
          </AuthProvider>
        </ServicesProvider>
      </MemoryRouter>,
    );
  });
  // Let boot reconciliation + data loads settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return services;
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text);
}

describe('Admin screen', () => {
  it('renders section headers for an admin — and no stats surface', async () => {
    await mountAdmin('admin');
    // UI-0 removed the "This week" tiles: the figures are collected, not shown.
    expect(container.textContent).not.toContain('This week');
    expect(container.textContent).not.toContain('Export activity');
    // Section headers — shop-level only. Appendix E removed the ambient
    // cross-account "Activity" feed from the admin home.
    const headers = Array.from(container.querySelectorAll('.section-h')).map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Needs a look', 'Accounts']));
    expect(headers).not.toContain('Activity');
    // "Needs a look" is collapsed by default — no alert until expanded.
    expect(container.querySelector('.alert')).toBeNull();
    const collapse = container.querySelector('.admin-collapse') as HTMLButtonElement;
    expect(collapse).not.toBeNull();
    await act(async () => {
      collapse.click();
    });
    // Alert from getAlerts now visible.
    expect(container.querySelector('.alert')).not.toBeNull();
  });

  it('shows "Admins only" for a signed-in non-admin', async () => {
    await mountAdmin('staff');
    expect(container.textContent).toContain('Admins only');
    expect(container.querySelector('.stat')).toBeNull();
  });

  it('Configure → a program "Change" opens the value edit sheet, with no PIN', async () => {
    await mountAdmin('admin');
    // The program rows live behind the Configure popover now.
    const configure = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Configure program',
    ) as HTMLButtonElement | undefined;
    expect(configure).toBeDefined();
    await act(async () => {
      configure!.click();
    });
    const change = Array.from(container.querySelectorAll('button.edit')).find(
      (b) => b.textContent === 'Change',
    ) as HTMLButtonElement | undefined;
    expect(change).toBeDefined();
    await act(async () => {
      change!.click();
    });
    expect(container.querySelector('.sheet')).not.toBeNull();
    expect(container.querySelector('.progedit input')).not.toBeNull();
    // A7: the sheet's own Save confirms; nothing asks for a credential.
    expect(container.querySelector('.pin-dots')).toBeNull();
    expect(container.querySelector('.keypad')).toBeNull();
  });

  it('"Sign out all devices" asks plainly, then signs this device out with the rest', async () => {
    const services = await mountAdmin('admin');
    await act(async () => {
      buttonNamed('Sign out all devices')!.click();
    });
    // A plain "are you sure?" — no PIN pad (A7).
    expect(container.querySelector('.confirm-title')?.textContent).toBe('Sign out all devices?');
    expect(container.querySelector('.keypad')).toBeNull();
    expect(services.staff.revokeAllSessions).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed('Sign out all')!.click();
    });
    expect(services.staff.revokeAllSessions).toHaveBeenCalledWith();
    // The server ended this session too, so the screen goes to sign-in.
    expect(container.querySelector('.at-login')).not.toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('"Sign out all devices" can be cancelled without calling the server', async () => {
    const services = await mountAdmin('admin');
    await act(async () => {
      buttonNamed('Sign out all devices')!.click();
    });
    await act(async () => {
      buttonNamed('Cancel')!.click();
    });
    expect(container.querySelector('.confirm-title')).toBeNull();
    expect(services.staff.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('Add profile asks for name, username, password and role — no PIN', async () => {
    const services = await mountAdmin('admin');
    await act(async () => {
      buttonNamed('Add profile')!.click();
    });
    const labels = Array.from(container.querySelectorAll('.admin-create label')).map(
      (l) => l.textContent ?? '',
    );
    expect(labels.some((l) => l.includes('PIN'))).toBe(false);
    expect(container.querySelector('.admin-create')?.textContent).not.toContain('PIN');

    const inputs = container.querySelectorAll<HTMLInputElement>('.admin-create input');
    const type = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      type(inputs[0]!, 'Maria');
      type(inputs[1]!, 'maria');
      type(inputs[2]!, 'a-long-password');
    });
    await act(async () => {
      buttonNamed('Create account')!.click();
    });
    expect(services.staff.create).toHaveBeenCalledWith('maria', 'a-long-password', 'staff', 'Maria');
  });

  it('an account popover offers management actions but no activity history', async () => {
    await mountAdmin('admin');
    const row = container.querySelector('.acct-row, .admin-acct') as HTMLElement | null;
    const opener =
      row ??
      (Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('sam · admin'),
      ) as HTMLElement | undefined) ??
      null;
    expect(opener).not.toBeNull();
    await act(async () => {
      opener!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Management actions are present…
    expect(container.textContent).toContain('Delete profile');
    // …with no PIN to reset (S1)…
    expect(container.textContent).not.toContain('Reset PIN');
    // …but reading one person's history is an investigation, not a glance:
    // it lives behind the export workflow only.
    expect(container.querySelector('.acct-feed')).toBeNull();
    expect(container.querySelector('.acct-h')).toBeNull();
  });

  it('Configure exposes the two detector thresholds as editable rows', async () => {
    await mountAdmin('admin');
    const configure = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Configure program',
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      configure!.click();
    });

    const labels = Array.from(container.querySelectorAll('.stats .setlabel')).map(
      (n) => n.textContent,
    );
    expect(labels).toContain('Self-dealing window');
    expect(labels).toContain('Self-dealing flags at');
    expect(labels).toContain('Repeat-target window');
    expect(labels).toContain('Repeat-target flags above');
    // Alerts surface, never block — the panel says so.
    expect(container.textContent).toContain('only flag for review');
  });
});

describe('admin parts render donor classes', () => {
  async function mountNode(node: React.ReactNode) {
    await act(async () => {
      root.render(node);
    });
  }

  it('StatWide', async () => {
    await mountNode(<StatWide setLabel="Reward at" setVal="10 coffees" onEdit={() => {}} />);
    expect(container.querySelector('.stat.wide .setlabel')?.textContent).toBe('Reward at');
    expect(container.querySelector('.stat.wide .setval')?.textContent).toBe('10 coffees');
    expect(container.querySelector('.stat.wide .edit')?.textContent).toBe('Change');
  });

  it('FeedRow', async () => {
    await mountNode(<FeedRow tone="add" icon={<svg />} text="Sam" time="2m" />);
    const row = container.querySelector('.row');
    expect(row?.classList.contains('add')).toBe(true);
    expect(container.querySelector('.row .ri')).not.toBeNull();
    expect(container.querySelector('.row .rt')?.textContent).toBe('Sam');
    expect(container.querySelector('.row .rtime')?.textContent).toBe('2m');
  });

  it('Alert', async () => {
    await mountNode(<Alert title="Unusual volume" detail="too many" time="9m" />);
    expect(container.querySelector('.alert .at')?.textContent).toBe('Unusual volume');
    expect(container.querySelector('.alert .as')?.textContent).toBe('too many');
    expect(container.querySelector('.alert .ag')?.textContent).toBe('9m');
  });
});
