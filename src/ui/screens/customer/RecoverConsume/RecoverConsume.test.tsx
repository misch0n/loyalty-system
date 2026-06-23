import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
let params: { code?: string } = { code: 'good-code' };
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params,
}));

import { RecoverConsume } from './RecoverConsume';
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
  params = { code: 'good-code' };
});

function fakeServices(redeem: ReturnType<typeof vi.fn>): Services {
  return {
    recovery: { redeem },
    identity: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn(), clear: vi.fn() },
  } as unknown as Services;
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <RecoverConsume />
      </ServicesProvider>,
    );
  });
}

describe('RecoverConsume', () => {
  it('redeems the code, stores the token and navigates to the card', async () => {
    const redeem = vi.fn().mockResolvedValue({ token: 'restored-tok' });
    const services = fakeServices(redeem);
    await mount(services);

    expect(redeem).toHaveBeenCalledWith('good-code');
    expect(services.identity.set).toHaveBeenCalledWith('restored-tok');
    expect(navigate).toHaveBeenCalledWith('/card/restored-tok', { replace: true });
  });

  it('shows the invalid state when the code does not redeem', async () => {
    const redeem = vi.fn().mockResolvedValue(null);
    await mount(fakeServices(redeem));
    expect(container.textContent).toContain('This link can’t be used');
    expect(navigate).not.toHaveBeenCalled();
  });
});
