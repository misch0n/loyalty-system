import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
let params: { token?: string } = { token: 'tok-card-1' };
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params,
}));

import { Card } from './Card';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';
import type { CustomerState } from '../../../../services/LoyaltyService';
import { ApiError } from '../../../../services/errors';
import type { Customer, ProgramConfig, Reward } from '@cafe/shared/domain/models';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  params = { token: 'tok-card-1' };
});

const customer: Customer = {
  id: 'c1',
  token: 'tok-card-1',
  shortCode: 'ABCD1234',
  displayName: 'Maria',
  status: 'active',
  createdAt: new Date().toISOString(),
};

const config = {
  pointsPerReward: 10,
  rewardDescription: 'free coffee',
  pointsPerPurchase: 1,
  maxPointsPerTransaction: 5,
  cardInactivityDays: 365,
} as ProgramConfig;

function reward(n: number): Reward {
  return {
    id: `r${n}`,
    token: `rtok-${n}`,
    shortCode: `CODE${n}`,
    ownerId: 'c1',
    status: 'unspent',
    issuedAt: `2026-01-0${n}T00:00:00.000Z`,
    sourceTxnId: `tx${n}`,
    descriptionSnapshot: 'free coffee',
  };
}

function state(current: number, rewards: Reward[]): CustomerState {
  return {
    customer,
    config,
    transactions: [],
    balance: current,
    rewardAvailable: rewards.length > 0,
    rewards,
    progress: { current, threshold: 10, rewardsAvailable: rewards.length },
  };
}

// The Card resolves token → id via getStateByToken, then reads the reward-aware
// view via getState(id) — both return the same fake state here.
function fakeServices(
  cs: CustomerState,
  get: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue('tok-card-1'),
): Services {
  return {
    loyalty: {
      getStateByToken: vi.fn().mockResolvedValue(cs),
      getState: vi.fn().mockResolvedValue(cs),
    },
    identity: { get, set: vi.fn(), clear: vi.fn() },
  } as unknown as Services;
}

async function render(services: Services) {
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <Card />
      </ServicesProvider>,
    );
  });
  // Let the async state fetch settle.
  await settle();
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await render(services);
}

/**
 * A fresh `loyalty` re-runs the fetch for the card on screen — the refresh the
 * SSE subscriber (UI-5) will trigger. Same token, so it is not a first load.
 */
async function refreshWith(
  getStateByToken: ReturnType<typeof vi.fn>,
  identity = vi.fn().mockResolvedValue('tok-card-1'),
) {
  const services = {
    loyalty: { getStateByToken, getState: vi.fn().mockResolvedValue(state(5, [])) },
    identity: { get: identity, set: vi.fn(), clear: vi.fn() },
  } as unknown as Services;
  await render(services);
  return services;
}

const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? '';

describe('Card', () => {
  it('renders the collecting state on a blush background', async () => {
    await mount(fakeServices(state(7, [])));
    expect(container.querySelector('.screen.bg-blush')).not.toBeNull();
    expect(container.querySelector('.progress-note')).not.toBeNull();
    expect(container.textContent).toContain('Maria');
    expect(container.querySelector('.ready-banner')).toBeNull();
  });

  it('renders the reward state on a sage background when an unspent reward is owned', async () => {
    await mount(fakeServices(state(0, [reward(1)])));
    expect(container.querySelector('.screen.bg-sage')).not.toBeNull();
    expect(container.querySelector('.ready-banner')).not.toBeNull();
  });

  it('shows the multi-reward count badge for 2+ unspent rewards', async () => {
    await mount(fakeServices(state(2, [reward(1), reward(2)])));
    expect(container.querySelector('.ready-badge')?.textContent).toContain('2');
  });

  it('shows no "viewing someone else’s card" banner — opening a card link binds it', async () => {
    // Even a device that remembers a different card: the server rebinds on view.
    const services = fakeServices(state(3, []), vi.fn().mockResolvedValue('tok-other'));
    await mount(services);
    expect(container.textContent).not.toContain('Viewing');
    expect(container.querySelector('.context-banner')).toBeNull();
    expect(services.identity.get).not.toHaveBeenCalled();
  });

  describe('/card self-resolve', () => {
    it('opens the card this device is bound to', async () => {
      params = {};
      await mount(fakeServices(state(0, []), vi.fn().mockResolvedValue('tok-bound')));
      expect(navigate).toHaveBeenCalledWith('/card/tok-bound', { replace: true });
    });

    it('goes to welcome when the device is not bound', async () => {
      params = {};
      await mount(fakeServices(state(0, []), vi.fn().mockResolvedValue(null)));
      expect(navigate).toHaveBeenCalledWith('/welcome', { replace: true });
    });

    it('never sends an offline phone to welcome — it offers Try again instead', async () => {
      params = {};
      const get = vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ kind: 'offline' }))
        .mockResolvedValueOnce('tok-bound');
      await mount(fakeServices(state(0, []), get));
      expect(navigate).not.toHaveBeenCalled();
      expect(alertText()).toContain('Your card and cups are safe');
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();

      await click(button('Try again')!);
      expect(get).toHaveBeenCalledTimes(2);
      expect(navigate).toHaveBeenCalledWith('/card/tok-bound', { replace: true });
    });
  });

  describe('first load fails', () => {
    function failing(err: unknown, then?: CustomerState) {
      const getStateByToken = vi.fn().mockRejectedValueOnce(err);
      if (then) getStateByToken.mockResolvedValue(then);
      return {
        loyalty: { getStateByToken, getState: vi.fn().mockResolvedValue(then) },
        identity: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
      } as unknown as Services;
    }

    it('offline: no endless skeleton — says the card is safe and offers Try again', async () => {
      await mount(failing(new ApiError({ kind: 'offline' })));
      expect(container.querySelector('.card-skeleton')).toBeNull();
      expect(container.textContent).toContain('We couldn’t load your card');
      expect(alertText()).toBe(
        'Couldn’t reach the café’s server. Your card and cups are safe — try again when you’re back online.',
      );
      expect(button('Try again')).toBeDefined();
    });

    it('server: blames the server, not the connection', async () => {
      await mount(failing(new ApiError({ kind: 'server', status: 500 })));
      expect(alertText()).toContain('server had a problem');
      expect(alertText()).not.toMatch(/online|connection/i);
    });

    it('anything else gets the plain fallback', async () => {
      await mount(failing(new TypeError('boom')));
      expect(alertText()).toBe('Something went wrong loading your card. Try again.');
    });

    it('Try again re-fetches and shows the card', async () => {
      const services = failing(new ApiError({ kind: 'offline' }), state(4, []));
      await mount(services);
      await click(button('Try again')!);
      expect(services.loyalty.getStateByToken).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('Maria');
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector('.context-banner')).toBeNull();
    });
  });

  describe('a card that is not there', () => {
    it('shows "couldn’t find" when the lookup answers null', async () => {
      const services = fakeServices(state(0, []));
      (services.loyalty.getStateByToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await mount(services);
      expect(container.textContent).toContain('We couldn’t find this card');
    });

    it('treats a thrown not_found the same way, not as a failure', async () => {
      const services = fakeServices(state(0, []));
      (services.loyalty.getState as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError({ kind: 'not_found', code: 'customer_not_found' }),
      );
      await mount(services);
      expect(container.textContent).toContain('We couldn’t find this card');
      expect(button('Try again')).toBeUndefined();
    });
  });

  describe('a refresh fails while the card is on screen', () => {
    it('offline: keeps the last-known card and says so; the next success clears it', async () => {
      await mount(fakeServices(state(7, [])));
      const getStateByToken = vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ kind: 'offline' }))
        .mockResolvedValue(state(5, []));
      await refreshWith(getStateByToken);

      expect(container.textContent).toContain('Maria');
      const banner = container.querySelector('.context-banner')?.textContent ?? '';
      expect(banner).toContain('You’re offline — showing your card as it was last seen.');
      expect(banner).toContain('Your cups are safe');

      // Try again on the banner re-fetches; success drops the banner.
      await click(button('Try again')!);
      expect(getStateByToken).toHaveBeenCalledTimes(2);
      expect(container.querySelector('.context-banner')).toBeNull();
      expect(container.textContent).toContain('Maria');
    });

    it('any later success clears the banner too', async () => {
      await mount(fakeServices(state(7, [])));
      await refreshWith(vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' })));
      expect(container.querySelector('.context-banner')).not.toBeNull();
      await refreshWith(vi.fn().mockResolvedValue(state(5, [])));
      expect(container.querySelector('.context-banner')).toBeNull();
    });

    it('server: says the server had a problem, not that the phone is offline', async () => {
      await mount(fakeServices(state(7, [])));
      await refreshWith(vi.fn().mockRejectedValue(new ApiError({ kind: 'server', status: 502 })));
      const banner = container.querySelector('.context-banner')?.textContent ?? '';
      expect(banner).toContain('server had a problem');
      expect(banner).not.toMatch(/offline/i);
    });

    it('any other failure keeps the card with no banner and no error', async () => {
      await mount(fakeServices(state(7, [])));
      await refreshWith(vi.fn().mockRejectedValue(new ApiError({ kind: 'rejected', code: 'x' })));
      expect(container.textContent).toContain('Maria');
      expect(container.querySelector('.context-banner')).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('a card deleted under the customer shows "couldn’t find"', async () => {
      await mount(fakeServices(state(7, [])));
      await refreshWith(vi.fn().mockResolvedValue(null));
      expect(container.textContent).toContain('We couldn’t find this card');
    });
  });
});
