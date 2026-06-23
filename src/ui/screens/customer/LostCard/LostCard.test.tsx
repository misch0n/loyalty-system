import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { LostCard } from './LostCard';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function fakeServices(request = vi.fn().mockResolvedValue(undefined)): Services {
  return { recovery: { request } } as unknown as Services;
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <LostCard />
      </ServicesProvider>,
    );
  });
}

describe('LostCard', () => {
  it('calls recovery.request and shows the uniform confirmation', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const services = fakeServices(request);
    await mount(services);

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'maria@example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Send restore link',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(request).toHaveBeenCalledWith('maria@example.com');
    expect(container.querySelector('.lost-sent')).not.toBeNull();
  });
});
