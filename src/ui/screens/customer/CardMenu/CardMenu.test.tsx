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
});

const customer: Customer = {
  id: 'c1',
  token: 'tok-abc',
  displayName: 'Maria',
  email: 'maria@example.com',
  status: 'active',
  createdAt: new Date().toISOString(),
};

function fakeServices(selfDelete: ReturnType<typeof vi.fn>): Services {
  return {
    customers: { selfDelete },
    identity: {
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    },
  } as unknown as Services;
}

async function mount(services: Services) {
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
          saved
          onSavedChange={() => {}}
          token={customer.token}
        />
      </ServicesProvider>,
    );
  });
}

function deleteRow() {
  return Array.from(container.querySelectorAll('button.menu-row')).find((b) =>
    b.classList.contains('danger'),
  ) as HTMLButtonElement;
}

describe('CardMenu', () => {
  it('deletes the card after a confirm tap and clears identity + routes home', async () => {
    const selfDelete = vi.fn().mockResolvedValue(undefined);
    const services = fakeServices(selfDelete);
    await mount(services);

    // First tap arms the confirm.
    await act(async () => {
      deleteRow().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(selfDelete).not.toHaveBeenCalled();

    // Second tap commits.
    await act(async () => {
      deleteRow().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(selfDelete).toHaveBeenCalledWith(customer.token);
    expect(services.identity.clear).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/welcome', { replace: true });
  });
});
