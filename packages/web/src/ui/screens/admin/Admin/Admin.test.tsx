import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Services } from '../../../../services/Services';
import type { Actor } from '../../../../services/types';
import { ServicesProvider } from '../../../common/ServicesContext';
import { AuthProvider } from '../../../app/AuthContext';
import { LogoGesturesProvider } from '../../../app/LogoGestures';
import { ToastProvider } from '../../../components/Toast/Toast';
import { Stat, StatWide } from '../_parts/Stat/Stat';
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
      getStats: vi.fn().mockResolvedValue({
        activeCustomers: 312,
        pointsIssued: 900,
        rewardsRedeemed: 19,
      }),
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
      loginWithPin: vi.fn().mockResolvedValue({ ok: true, actor }),
      setPin: vi.fn().mockResolvedValue(undefined),
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
      lastActivity: Date.now(),
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

async function mountAdmin(role: 'admin' | 'staff') {
  seedSession(role);
  const services = fakeServices(role);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/admin']}>
        <ServicesProvider value={services}>
          <AuthProvider>
            <LogoGesturesProvider value={{}}>
              <ToastProvider>
                <Admin />
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
}

describe('Admin screen', () => {
  it('renders derived stats and section headers for an admin', async () => {
    await mountAdmin('admin');
    expect(container.textContent).toContain('This week');
    expect(container.querySelector('.stats')).not.toBeNull();
    expect(container.textContent).toContain('Active members');
    expect(container.textContent).toContain('312'); // from getStats
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
    expect(container.querySelector('.stats')).toBeNull();
  });

  it('Configure → a program "Change" opens the value+PIN edit sheet', async () => {
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
    expect(container.querySelector('.pin-dots')).not.toBeNull();
  });

  it('a stat breakdown shows the chart only — no attributed per-action list', async () => {
    await mountAdmin('admin');
    const tile = container.querySelector('.stat') as HTMLElement;
    expect(tile).not.toBeNull();
    await act(async () => {
      tile.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The breakdown popover is open with its chart…
    expect(container.querySelector('.statdetail')).not.toBeNull();
    expect(container.querySelector('.statdetail-bars')).not.toBeNull();
    // …but Appendix E removed the ambient per-action feed that sat beneath it.
    expect(container.querySelector('.statdetail .feed')).toBeNull();
    expect(container.querySelector('.statdetail-more')).toBeNull();
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

  it('Stat / StatWide', async () => {
    await mountNode(
      <>
        <Stat n={5} label="Members" delta="+1" />
        <StatWide setLabel="Reward at" setVal="10 coffees" onEdit={() => {}} />
      </>,
    );
    expect(container.querySelector('.stat .n')?.textContent).toBe('5');
    expect(container.querySelector('.stat .l')?.textContent).toBe('Members');
    expect(container.querySelector('.stat .delta')?.textContent).toBe('+1');
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
