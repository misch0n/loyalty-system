import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Services } from '../../../../services/Services';
import type { Actor } from '../../../../services/types';
import { ServicesProvider } from '../../../common/ServicesContext';
import { AuthProvider } from '../../../app/AuthContext';
import { LogoGesturesProvider } from '../../../app/LogoGestures';
import { ToastProvider } from '../../../components/Toast/Toast';
import { Scan } from './Scan';

// jsdom has no camera; capture the scanner's decode callback so tests can inject
// a scanned code directly.
const scanMock = vi.hoisted(() => ({ cb: null as ((text: string) => void) | null }));
vi.mock('../../../../qr/scan', () => ({
  startScanner: vi.fn(async (_id: string, cb: (text: string) => void) => {
    scanMock.cb = cb;
    return { stop: vi.fn().mockResolvedValue(undefined) };
  }),
}));
// Resolve scans deterministically: a `/r?ids=…&c=…` URL → reward scan, anything
// else → a plain card scan for the same token.
vi.mock('../../../../qr/encode', () => ({
  parseScan: (text: string) => {
    const reward = text.match(/\/r\?ids=([^&]+)&c=([^&]+)/);
    if (reward) {
      return {
        kind: 'reward',
        customerToken: decodeURIComponent(reward[2]),
        rewardTokens: reward[1].split(',').filter(Boolean),
        source: 'a',
      };
    }
    return { kind: 'card', customerToken: text, rewardTokens: [], source: 'a' };
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_KEY = 'cafe-loyalty.staffSession';
const STAFFER: Actor = { id: 's1', username: 'Sam', role: 'staff' };

const CONFIG = {
  pointsPerReward: 10,
  rewardDescription: 'Free coffee',
  pointsPerPurchase: 1,
  maxPointsPerTransaction: 3,
  cardInactivityDays: 90,
};

function reward(id: string, token: string) {
  return {
    id,
    token,
    shortCode: 'ABCD1234',
    ownerId: 'c1',
    status: 'unspent',
    issuedAt: new Date().toISOString(),
    sourceTxnId: 't0',
    descriptionSnapshot: 'Free coffee',
  };
}

function stateFor(balance: number, rewards: ReturnType<typeof reward>[] = []) {
  return {
    customer: { id: 'c1', token: 'PROTOcard0000000000001', displayName: 'Maria' },
    config: CONFIG,
    transactions: [],
    balance,
    rewardAvailable: rewards.length > 0,
    rewards,
    progress: { current: balance, threshold: CONFIG.pointsPerReward, rewardsAvailable: rewards.length },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  scanMock.cb = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

function fakeServices(overrides: Partial<Record<string, unknown>> = {}): Services {
  return {
    staff: { currentSessionEpoch: vi.fn().mockResolvedValue(1) },
    loyalty: {
      getStateByToken: vi.fn().mockResolvedValue(stateFor(7)),
      getStateByShortCode: vi.fn().mockResolvedValue(stateFor(7)),
      getState: vi.fn().mockResolvedValue(stateFor(7)),
      commit: vi.fn().mockResolvedValue({
        ok: true,
        state: stateFor(9),
        minted: [],
        redeemed: [],
        rejected: [],
      }),
      undo: vi.fn().mockResolvedValue({
        ok: true,
        state: stateFor(7),
        minted: [],
        redeemed: [],
        rejected: [],
      }),
      ...overrides,
    },
    customers: { provisionFromToken: vi.fn() },
    wallet: { pushUpdate: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Services;
}

function seedSession() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      actorId: STAFFER.id,
      username: STAFFER.username,
      role: STAFFER.role,
      epoch: 1,
      lastActivity: Date.now(),
    }),
  );
}

async function mountScan(services: Services) {
  seedSession();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/staff/scan']}>
        <ServicesProvider value={services}>
          <AuthProvider>
            <LogoGesturesProvider value={{}}>
              <ToastProvider>
                <Routes>
                  <Route path="/staff/scan" element={<Scan />} />
                  <Route path="/staff" element={<div>STAFF PANEL</div>} />
                  <Route path="/login" element={<div>LOGIN</div>} />
                </Routes>
              </ToastProvider>
            </LogoGesturesProvider>
          </AuthProvider>
        </ServicesProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function inject(code: string) {
  await act(async () => {
    scanMock.cb?.(code);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function forestButton(label: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button.btn-forest')).find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement;
}

describe('Staff Scan', () => {
  it('starts in the scanning state with the ScanView frame', async () => {
    await mountScan(fakeServices());
    expect(container.querySelector('.topbar')).not.toBeNull();
    expect(container.querySelector('.scanview')).not.toBeNull();
    expect(container.querySelector('.staff-scan__region')).not.toBeNull();
  });

  it('resolves to the rewards-aware state and the commit button tracks the slider', async () => {
    await mountScan(fakeServices());
    await inject('PROTOcard0000000000001');

    // CustChip confirms WHO (Maria, 7 of 10 cups).
    expect(container.querySelector('.cust .cn')?.textContent).toBe('Maria');
    expect(container.querySelector('.cust .cs')?.textContent).toBe('7 of 10 cups');

    // Commit button starts at "Add 1 coffee" (card scan defaults to one coffee).
    expect(forestButton('Add 1 coffee')).toBeDefined();

    // Move the slider → label follows.
    const slider = container.querySelector('.assign input[type=range]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(slider, '2');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(forestButton('Add 2 coffees')).toBeDefined();

    // No rewards yet → "to go" line shows the gap.
    expect(container.querySelector('.elig')?.textContent).toContain('3 to go');
  });

  it('commits points with the unified commit and then offers Undo', async () => {
    const services = fakeServices();
    await mountScan(services);
    await inject('PROTOcard0000000000001');

    await act(async () => {
      forestButton('Add 1 coffee').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const commit = services.loyalty.commit as ReturnType<typeof vi.fn>;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][1]).toMatchObject({
      customerId: 'c1',
      pointsDelta: 1,
      redeemRewardIds: [],
      source: 'a',
    });
    expect(typeof commit.mock.calls[0][1].idempotencyKey).toBe('string');

    // Best-effort wallet push reflects the settled balance + unspent-reward COUNT
    // (rewards-as-objects: a count, not the old `rewardAvailable` boolean).
    const pushUpdate = services.wallet.pushUpdate as ReturnType<typeof vi.fn>;
    expect(pushUpdate).toHaveBeenCalledWith('c1', { balance: 9, rewardCount: 0 });

    // Committed state shows an Undo affordance.
    const undo = Array.from(container.querySelectorAll('button.btn-line')).find((b) =>
      b.textContent === 'Undo',
    ) as HTMLButtonElement;
    expect(undo).toBeDefined();

    await act(async () => {
      undo.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((services.loyalty.undo as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('pre-checks a scanned reward and redeems it on commit', async () => {
    const services = fakeServices({
      getStateByToken: vi.fn().mockResolvedValue(stateFor(3, [reward('rw1', 'rtok1')])),
      getState: vi.fn().mockResolvedValue(stateFor(3, [reward('rw1', 'rtok1')])),
      commit: vi.fn().mockResolvedValue({
        ok: true,
        state: stateFor(3),
        minted: [],
        redeemed: [reward('rw1', 'rtok1')],
        rejected: [],
      }),
    });
    await mountScan(services);
    await inject('/r?ids=rtok1&c=PROTOcard0000000000001');

    // The scanned reward is pre-checked.
    const box = container.querySelector(
      '.staff-scan__reward input[type=checkbox]',
    ) as HTMLInputElement;
    expect(box.checked).toBe(true);

    // Reward scan defaults to 0 points → button is "Redeem 1".
    await act(async () => {
      forestButton('Redeem 1').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const commit = services.loyalty.commit as ReturnType<typeof vi.fn>;
    expect(commit.mock.calls[0][1]).toMatchObject({
      pointsDelta: 0,
      redeemRewardIds: ['rw1'],
    });
  });

  it('surfaces an over_cap rejection as an error', async () => {
    const services = fakeServices({
      commit: vi.fn().mockResolvedValue({ ok: false, error: 'over_cap' }),
    });
    await mountScan(services);
    await inject('PROTOcard0000000000001');

    await act(async () => {
      forestButton('Add 1 coffee').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.staff-scan__error')?.textContent).toContain('limit');
  });
});
