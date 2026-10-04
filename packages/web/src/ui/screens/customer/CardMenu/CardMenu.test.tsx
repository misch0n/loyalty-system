import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { CardMenu } from './CardMenu';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';
import { ApiError } from '../../../../services/errors';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function fakeServices(selfDelete = vi.fn().mockResolvedValue(undefined)): Services {
  return {
    customers: { selfDelete },
    identity: {
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    },
  } as unknown as Services;
}

const TOKEN = 'tok-abc';

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <CardMenu open onClose={() => {}} token={TOKEN} />
      </ServicesProvider>,
    );
  });
}

const rows = () => Array.from(container.querySelectorAll('button.menu-row'));
const deleteRow = () => rows().find((b) => b.classList.contains('danger')) as HTMLButtonElement;
const holdBtn = () => container.querySelector('.hold-btn') as HTMLButtonElement;
const tap = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('CardMenu', () => {
  it('has exactly one entry — delete; no remember/remove-from-device row or banner', async () => {
    await mount(fakeServices());
    expect(rows()).toHaveLength(1);
    expect(deleteRow().textContent).toContain('Delete my card');
    expect(container.textContent).not.toMatch(/remember|remove/i);
    expect(container.querySelector('.context-banner, [role="switch"]')).toBeNull();
  });

  it('delete: says what is erased and that the email frees up', async () => {
    await mount(fakeServices());
    await tap(deleteRow());
    const msg = container.querySelector('.card-confirm-msg')?.textContent ?? '';
    expect(msg).toContain('PERMANENTLY erases your card');
    expect(msg).toContain('cups and rewards');
    expect(msg).toContain('your name and email');
    expect(msg).toContain('free to start a new card, from zero');
  });

  it('delete: redraws a hold-to-confirm; the 3s hold erases + clears + routes home', async () => {
    vi.useFakeTimers();
    const services = fakeServices();
    await mount(services);

    await tap(deleteRow());
    // Confirmation + a hold button appear; nothing deleted on the tap.
    expect(holdBtn()).not.toBeNull();
    expect(holdBtn().classList.contains('hold')).toBe(true);
    expect(services.customers.selfDelete).not.toHaveBeenCalled();

    // A short hold released early does NOT delete.
    await act(async () => {
      holdBtn().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      holdBtn().dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(services.customers.selfDelete).not.toHaveBeenCalled();

    // A full 3s hold commits.
    await act(async () => {
      holdBtn().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(services.customers.selfDelete).toHaveBeenCalledWith(TOKEN);
    expect(services.identity.clear).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/welcome', { replace: true });
  });

  it('delete: a failed un-bind after the erase still routes home, with no error', async () => {
    vi.useFakeTimers();
    const services = fakeServices();
    (services.identity.clear as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    await mount(services);

    await tap(deleteRow());
    await act(async () => {
      holdBtn().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(services.customers.selfDelete).toHaveBeenCalledWith(TOKEN);
    expect(navigate).toHaveBeenCalledWith('/welcome', { replace: true });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('"Keep my card" returns to the menu without deleting', async () => {
    const services = fakeServices();
    await mount(services);
    await tap(deleteRow());
    const keep = container.querySelector('.card-confirm-cancel') as HTMLButtonElement;
    await tap(keep);
    expect(rows()).toHaveLength(1);
    expect(services.customers.selfDelete).not.toHaveBeenCalled();
  });

  describe('a failed delete says why, inside the sheet', () => {
    async function holdToDelete(err: unknown) {
      vi.useFakeTimers();
      const services = fakeServices(vi.fn().mockRejectedValue(err));
      await mount(services);
      await tap(deleteRow());
      await act(async () => {
        holdBtn().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      return services;
    }
    const alert = () => container.querySelector('.card-menu-error[role="alert"]')?.textContent;

    it('offline: could not reach the server', async () => {
      const services = await holdToDelete(new ApiError({ kind: 'offline' }));
      expect(alert()).toBe(
        'Couldn’t reach the server. Check this device’s internet connection, then try again.',
      );
      expect(services.identity.clear).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      // Still on the confirmation, ready to hold again.
      expect(holdBtn().disabled).toBe(false);
    });

    it('server: the server failed, not the connection', async () => {
      await holdToDelete(new ApiError({ kind: 'server', status: 500 }));
      expect(alert()).toContain('server had a problem');
    });

    it('an out-of-date page is told to reload', async () => {
      await holdToDelete(new ApiError({ kind: 'forbidden', code: 'csrf_failed' }));
      expect(alert()).toBe('This page is out of date. Reload it, then try again.');
    });

    it('anything else gets the plain fallback', async () => {
      await holdToDelete(new ApiError({ kind: 'not_found', code: 'customer_not_found' }));
      expect(alert()).toBe('Couldn’t delete your card. Try again.');
    });
  });
});
