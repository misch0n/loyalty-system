import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
let params: { token?: string } = { token: 'tok-card-1' };
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params,
}));

vi.mock('../../../common/PairingContext', () => ({
  usePairing: () => ({ dataVersion: 0 }),
}));

import { Card } from './Card';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';
import type { CustomerState } from '../../../../services/LoyaltyService';
import type { Customer, ProgramConfig, Reward } from '../../../../domain/models';

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
function fakeServices(cs: CustomerState): Services {
  return {
    loyalty: {
      getStateByToken: vi.fn().mockResolvedValue(cs),
      getState: vi.fn().mockResolvedValue(cs),
    },
    identity: { get: vi.fn().mockResolvedValue('tok-card-1'), set: vi.fn(), clear: vi.fn() },
    wallet: { ensurePass: vi.fn() },
  } as unknown as Services;
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <Card />
      </ServicesProvider>,
    );
  });
  // Let the async state fetch settle.
  await act(async () => {
    await Promise.resolve();
  });
}

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
});
