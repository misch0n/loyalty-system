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
import type { Customer } from '../../../../domain/models';

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

const withRecovery: Customer = {
  id: 'c1',
  token: 'tok-abc',
  displayName: 'Maria',
  email: 'maria@example.com',
  status: 'active',
  createdAt: new Date().toISOString(),
};

const tokenOnly: Customer = {
  id: 'c2',
  token: 'tok-xyz',
  status: 'active',
  createdAt: new Date().toISOString(),
};

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

async function mount(services: Services, customer: Customer, saved = true) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <CardMenu
          open
          onClose={() => {}}
          customer={customer}
          saved={saved}
          onSavedChange={() => {}}
          token={customer.token}
        />
      </ServicesProvider>,
    );
  });
}

const deleteRow = () =>
  Array.from(container.querySelectorAll('button.menu-row')).find((b) =>
    b.classList.contains('danger'),
  ) as HTMLButtonElement;
const deviceRow = () =>
  Array.from(container.querySelectorAll('button.menu-row')).find(
    (b) => !b.classList.contains('danger'),
  ) as HTMLButtonElement;
const holdBtn = () => container.querySelector('.hold-btn') as HTMLButtonElement;
const tap = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('CardMenu', () => {
  it('delete: redraws a hold-to-confirm; the 3s hold erases + clears + routes home', async () => {
    vi.useFakeTimers();
    const services = fakeServices();
    await mount(services, withRecovery);

    await tap(deleteRow());
    // Confirmation copy + a hold button appear; nothing deleted on the tap.
    expect(container.textContent).toContain('PERMANENTLY delete');
    expect(holdBtn()).not.toBeNull();
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
    expect(services.customers.selfDelete).toHaveBeenCalledWith(withRecovery.token);
    expect(services.identity.clear).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/welcome', { replace: true });
  });

  it('remove (recoverable card): single-tap REMOVE clears the device identity', async () => {
    const services = fakeServices();
    await mount(services, withRecovery);

    await tap(deviceRow());
    // Recoverable: explains email recovery, no hold fineprint, single-tap button.
    expect(container.textContent).toContain('I already have one');
    expect(container.querySelector('.card-confirm-fine')).toBeNull();
    expect(holdBtn().classList.contains('tap')).toBe(true);

    await tap(holdBtn());
    expect(services.identity.clear).toHaveBeenCalled();
  });

  it('remove (token-only card): warns of loss and gates REMOVE behind a hold', async () => {
    const services = fakeServices();
    await mount(services, tokenOnly);

    await tap(deviceRow());
    expect(container.textContent).toContain('permanently lost');
    expect(container.querySelector('.card-confirm-fine')?.textContent).toContain('hold button');
    expect(holdBtn().classList.contains('hold')).toBe(true);
  });
});
