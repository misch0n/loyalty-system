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
import { ApiError } from '../../../../services/errors';
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
      session: vi.fn().mockResolvedValue({ status: 'active', actor: actor, epoch: 1, remembered: false }),
      logout: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ ...actor, active: true, createdAt: '' }),
      revokeAllSessions: vi.fn().mockResolvedValue(2),
      setActive: vi.fn().mockResolvedValue(undefined),
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

async function openConfigure() {
  const configure = buttonNamed('Configure program');
  await act(async () => {
    configure!.click();
  });
}

/** Open the ProgramEdit sheet for the Configure row with this label. */
async function editRow(label: string) {
  const row = Array.from(container.querySelectorAll('.stat.wide')).find(
    (r) => r.querySelector('.setlabel')?.textContent === label,
  );
  expect(row).toBeDefined();
  await act(async () => {
    (row!.querySelector('.edit') as HTMLButtonElement).click();
  });
}

function editorInput(): HTMLInputElement {
  return container.querySelector('.progedit input') as HTMLInputElement;
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openAccount(username: string) {
  const opener = Array.from(container.querySelectorAll('.acct-list-row')).find((b) =>
    b.querySelector('.alm')?.textContent?.startsWith(username),
  ) as HTMLButtonElement | undefined;
  expect(opener).toBeDefined();
  await act(async () => {
    opener!.click();
  });
}

describe('Configure — bounds, wording and the error path (A4, A5)', () => {
  it('names the reward threshold as drinks for a free one, and says what the card shows', async () => {
    await mountAdmin('admin');
    await openConfigure();
    const labels = Array.from(container.querySelectorAll('.stats .setlabel')).map(
      (n) => n.textContent,
    );
    expect(labels).toContain('Drinks for a free one');
    expect(labels).not.toContain('Reward earned at');

    await editRow('Drinks for a free one');
    const editor = container.querySelector('.progedit')!;
    expect(editor.textContent).toContain('How many drinks earn a free one?');
    expect(editor.querySelector('.hint')?.textContent).toContain('this many cups, plus the free one');
    // The server's own range for the field.
    expect(editor.querySelector('.hint')?.textContent).toContain('From 1 to 100.');
  });

  it('will not save a value outside the server’s bounds', async () => {
    const services = await mountAdmin('admin');
    await openConfigure();
    await editRow('Repeat-target flags above');
    // The detector counts floor at 2, as the server does — not 1.
    expect(container.querySelector('.progedit .hint')?.textContent).toContain('From 2 to 100.');

    await typeInto(editorInput(), '1');
    expect(buttonNamed('Save')!.disabled).toBe(true);
    // Not flashed mid-keystroke ("1" on the way to "15")…
    expect(container.querySelector('.progedit-error')).toBeNull();
    // …but said once typing pauses.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 650));
    });
    expect(container.querySelector('.progedit-error')?.textContent).toContain('from 2 to 100');

    await typeInto(editorInput(), '101');
    expect(buttonNamed('Save')!.disabled).toBe(true);

    await typeInto(editorInput(), '4');
    expect(container.querySelector('.progedit-error')).toBeNull();
    expect(buttonNamed('Save')!.disabled).toBe(false);
    expect(services.config.update).not.toHaveBeenCalled();
  });

  it('keeps the edit and says what went wrong on the editor when the save fails', async () => {
    const services = await mountAdmin('admin');
    (services.config.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError({ kind: 'rejected', code: 'invalid_request' }),
    );
    await openConfigure();
    await editRow('Drinks for a free one');
    await typeInto(editorInput(), '12');
    await act(async () => {
      buttonNamed('Save')!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(services.config.update).toHaveBeenCalledWith({ pointsPerReward: 12 });
    // Still open, with the admin's value…
    expect(editorInput().value).toBe('12');
    // …and the reason on the editor, not in a toast.
    expect(container.querySelector('.progedit-error')?.textContent).toContain(
      'Enter a whole number from 1 to 100',
    );
    expect(container.querySelector('.toast')).toBeNull();
  });

  it('reports an unreachable server on the editor too', async () => {
    const services = await mountAdmin('admin');
    (services.config.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError({ kind: 'offline' }),
    );
    await openConfigure();
    await editRow('Max coffees per scan');
    await act(async () => {
      buttonNamed('Save')!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('.progedit-error')?.textContent).toContain(
      'nothing was saved',
    );
    expect(container.querySelector('.toast')).toBeNull();
  });

  it('closes the editor and confirms once the save lands', async () => {
    const services = await mountAdmin('admin');
    await openConfigure();
    await editRow('Drinks for a free one');
    await typeInto(editorInput(), '9');
    await act(async () => {
      buttonNamed('Save')!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(services.config.update).toHaveBeenCalledWith({ pointsPerReward: 9 });
    expect(container.querySelector('.progedit')).toBeNull();
    expect(container.querySelector('.toast')?.textContent).toBe('Program updated.');
  });
});

describe('AccountSheet — your own account (A6)', () => {
  it('does not offer disabling or deleting the signed-in account', async () => {
    const services = await mountAdmin('admin');
    await openAccount('sam');

    const toggle = container.querySelector('.acct [role="switch"]') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(buttonNamed('Delete profile')!.disabled).toBe(true);
    expect(container.querySelector('.acct-note')?.textContent).toBe(
      'You can’t disable or delete the account you’re signed in with.',
    );

    await act(async () => {
      toggle.click();
    });
    expect(services.staff.setActive).not.toHaveBeenCalled();
  });

  it('offers both on another account', async () => {
    await mountAdmin('admin');
    await openAccount('aya');
    expect((container.querySelector('.acct [role="switch"]') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(buttonNamed('Delete profile')!.disabled).toBe(false);
    expect(container.querySelector('.acct-note')).toBeNull();
  });

  it('shows a refusal inside the sheet, not as a toast', async () => {
    const services = await mountAdmin('admin');
    (services.staff.setActive as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('You can’t disable the account you’re signed in with.'),
    );
    await openAccount('aya');
    await act(async () => {
      (container.querySelector('.acct [role="switch"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(services.staff.setActive).toHaveBeenCalledWith('s1', false);
    expect(container.querySelector('.acct-error')?.textContent).toBe(
      'You can’t disable the account you’re signed in with.',
    );
    expect(container.querySelector('.toast')).toBeNull();
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
