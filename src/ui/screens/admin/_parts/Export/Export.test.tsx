import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Services } from '../../../../../services/Services';
import type { Actor } from '../../../../../services/types';
import type { StaffAccount } from '../../../../../domain/models';
import { ServicesProvider } from '../../../../common/ServicesContext';
import { ToastProvider } from '../../../../components/Toast/Toast';
import { Export } from './Export';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADMIN: Actor = { id: 'a1', username: 'sam', role: 'admin' };

const STAFF_LIST = [
  { id: 'a1', username: 'sam', name: 'Sam', role: 'admin', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 's1', username: 'aya', name: 'Aya', role: 'staff', active: true, createdAt: '2026-01-01T00:00:00Z' },
] as unknown as StaffAccount[];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no download plumbing; stub what the JSON hand-off touches.
  URL.createObjectURL = vi.fn().mockReturnValue('blob:stub');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function fakeServices(pastExports: unknown[] = []): Services {
  return {
    audit: {
      list: vi.fn().mockResolvedValue(pastExports),
      exportActivity: vi.fn().mockResolvedValue([
        { id: 'e1', actorId: 's1', actorRole: 'staff', action: 'loyalty.accrue', timestamp: '2026-06-01T10:00:00Z' },
      ]),
    },
  } as unknown as Services;
}

async function mountExport(services: Services) {
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <ToastProvider>
          <Export open actor={ADMIN} staff={STAFF_LIST} onClose={() => {}} />
        </ToastProvider>
      </ServicesProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function runButton(): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Run export'),
  ) as HTMLButtonElement;
}

function setReason(text: string) {
  const inputs = Array.from(container.querySelectorAll('input.ip')) as HTMLInputElement[];
  const reason = inputs[inputs.length - 1];
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(reason, text);
  reason.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Export (admin investigation workflow)', () => {
  it('opens blank — no range, no preselected actions or accounts', async () => {
    await mountExport(fakeServices());
    const dateInputs = Array.from(
      container.querySelectorAll('input[type=datetime-local]'),
    ) as HTMLInputElement[];
    expect(dateInputs.every((i) => i.value === '')).toBe(true);
    // Every toggle starts off.
    const switches = Array.from(container.querySelectorAll('[role=switch]'));
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('lists every account including admins, so an investigation can name one', async () => {
    await mountExport(fakeServices());
    expect(container.textContent).toContain('Sam · admin');
    expect(container.textContent).toContain('Aya · staff');
  });

  it('requires a reason before it will run', async () => {
    const services = fakeServices();
    await mountExport(services);
    expect(runButton().disabled).toBe(true);

    await act(async () => {
      setReason('checking a disputed reward');
    });
    expect(runButton().disabled).toBe(false);
  });

  it('runs the export with the chosen filter and downloads a JSON file', async () => {
    const services = fakeServices();
    await mountExport(services);

    // Tick the first action group (counter activity).
    const firstSwitch = container.querySelector('[role=switch]') as HTMLButtonElement;
    await act(async () => {
      firstSwitch.click();
    });
    await act(async () => {
      setReason('disputed reward');
    });
    await act(async () => {
      runButton().click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const exportActivity = services.audit.exportActivity as ReturnType<typeof vi.fn>;
    expect(exportActivity).toHaveBeenCalledTimes(1);
    const [actor, filter, reason] = exportActivity.mock.calls[0];
    expect(actor).toEqual(ADMIN);
    expect(filter.actions).toContain('loyalty.accrue');
    expect(reason).toBe('disputed reward');
    // The result leaves as a file, not an on-screen feed.
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(container.querySelector('.feed')).toBeNull();
  });

  it('lists past exports and re-runs one as a NEW audited export', async () => {
    const services = fakeServices([
      {
        id: 'x1',
        actorId: 'a1',
        actorRole: 'admin',
        action: 'audit.export',
        timestamp: new Date().toISOString(),
        details: JSON.stringify({
          reason: 'earlier look',
          actions: ['loyalty.redeem'],
          count: 4,
        }),
      },
    ]);
    await mountExport(services);

    const row = container.querySelector('.export__past-row') as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('earlier look');
    expect(row.textContent).toContain('4 entries');

    await act(async () => {
      row.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const exportActivity = services.audit.exportActivity as ReturnType<typeof vi.fn>;
    const [, filter, reason] = exportActivity.mock.calls[0];
    expect(filter.actions).toEqual(['loyalty.redeem']);
    // A re-run is recorded as its own investigation, not a silent replay.
    expect(reason).toBe('Re-run: earlier look');
  });
});
