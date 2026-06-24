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
import type { Customer, ProgramConfig } from '../../../../domain/models';

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

function state(current: number, rewardAvailable: boolean): CustomerState {
  return {
    customer,
    config,
    transactions: [],
    balance: current,
    rewardAvailable,
    progress: { current, threshold: 10, rewardsAvailable: rewardAvailable ? 1 : 0 },
  };
}

function fakeServices(cs: CustomerState): Services {
  return {
    loyalty: { getStateByToken: vi.fn().mockResolvedValue(cs) },
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
    await mount(fakeServices(state(7, false)));
    expect(container.querySelector('.screen.bg-blush')).not.toBeNull();
    expect(container.querySelector('.progress-note')).not.toBeNull();
    expect(container.textContent).toContain('Maria');
    expect(container.querySelector('.ready-banner')).toBeNull();
  });

  it('renders the reward state on a sage background', async () => {
    await mount(fakeServices(state(10, true)));
    expect(container.querySelector('.screen.bg-sage')).not.toBeNull();
    expect(container.querySelector('.ready-banner')).not.toBeNull();
  });
});
