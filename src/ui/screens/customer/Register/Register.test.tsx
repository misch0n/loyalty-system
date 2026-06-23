import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { Register } from './Register';
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
  token: 'tok-123456',
  status: 'active',
  createdAt: new Date().toISOString(),
};

function fakeServices(over: Partial<Services> = {}): Services {
  const selfRegister = vi.fn().mockResolvedValue({ ok: true, customer });
  const set = vi.fn().mockResolvedValue(undefined);
  return {
    customers: { selfRegister },
    identity: { set, get: vi.fn(), clear: vi.fn() },
    ...over,
  } as unknown as Services;
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <Register />
      </ServicesProvider>,
    );
  });
}

describe('Register', () => {
  it('submits selfRegister, stores the token and navigates to the card', async () => {
    const services = fakeServices();
    await mount(services);

    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create my card',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(services.customers.selfRegister).toHaveBeenCalledTimes(1);
    expect(services.identity.set).toHaveBeenCalledWith(customer.token);
    expect(navigate).toHaveBeenCalledWith(`/card/${customer.token}`, { replace: true });
  });

  it('maps field errors onto the inputs', async () => {
    const selfRegister = vi
      .fn()
      .mockResolvedValue({ ok: false, errors: [{ field: 'email', message: 'Bad email' }] });
    const services = fakeServices({
      customers: { selfRegister },
    } as unknown as Partial<Services>);
    await mount(services);

    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create my card',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Bad email');
    expect(navigate).not.toHaveBeenCalled();
  });
});
