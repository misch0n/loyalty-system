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
// a scanned code directly (manual entry was removed).
const scanMock = vi.hoisted(() => ({ cb: null as ((text: string) => void) | null }));
vi.mock('../../../../qr/scan', () => ({
  startScanner: vi.fn(async (_id: string, cb: (text: string) => void) => {
    scanMock.cb = cb;
    return { stop: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), resume: vi.fn() };
  }),
}));
vi.mock('../../../../qr/encode', () => ({
  tokenFromCardScan: (text: string) => text,
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

function stateFor(balance: number) {
  return {
    customer: { id: 'c1', displayName: 'Maria' },
    config: CONFIG,
    transactions: [
      { id: 't1', customerId: 'c1', type: 'accrual', points: balance, staffId: 's1', timestamp: new Date().toISOString() },
    ],
    balance,
    rewardAvailable: balance >= CONFIG.pointsPerReward,
    progress: { current: balance, threshold: CONFIG.pointsPerReward, rewardsAvailable: 0 },
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

function fakeServices(): Services {
  return {
    staff: { currentSessionEpoch: vi.fn().mockResolvedValue(1) },
    loyalty: {
      getStateByToken: vi.fn().mockResolvedValue(stateFor(7)),
      getStateById: vi.fn().mockResolvedValue(stateFor(7)),
      accrue: vi.fn().mockResolvedValue({}),
      redeem: vi.fn().mockResolvedValue({ ok: true, balance: 0 }),
      reverse: vi.fn().mockResolvedValue({}),
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

async function mountScan() {
  seedSession();
  const services = fakeServices();
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
  return services;
}

async function resolveCard() {
  // Drive the camera path: fire the captured decode callback with a code.
  await act(async () => {
    scanMock.cb?.('PROTOcard0000000000001');
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Staff Scan', () => {
  it('starts in the scanning state with the ScanView frame', async () => {
    await mountScan();
    expect(container.querySelector('.topbar')).not.toBeNull();
    expect(container.querySelector('.scanview')).not.toBeNull();
    expect(container.querySelector('.staff-scan__region')).not.toBeNull();
  });

  it('resolved state shows the CustChip and the Add button label tracks the slider', async () => {
    await mountScan();
    await resolveCard();

    // CustChip confirms WHO (Maria, 7 of 10 cups, scanned pill).
    expect(container.querySelector('.cust .cn')?.textContent).toBe('Maria');
    expect(container.querySelector('.cust .cs')?.textContent).toBe('7 of 10 cups');
    expect(container.querySelector('.cust .ready')?.textContent).toBe('scanned');

    // Add button label starts at "Add 1 coffee".
    const addBtn = () =>
      Array.from(container.querySelectorAll('button.btn-forest')).find((b) =>
        b.textContent?.startsWith('Add'),
      ) as HTMLButtonElement;
    expect(addBtn().textContent).toBe('Add 1 coffee');

    // Move the slider → label follows.
    const slider = container.querySelector('.assign input[type=range]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(slider, '2');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(addBtn().textContent).toBe('Add 2 coffees');

    // Redeem is gated (balance 7 < 10) and the eligibility line shows the gap.
    const redeem = Array.from(container.querySelectorAll('button.btn-line')).find((b) =>
      b.textContent?.includes('Redeem'),
    ) as HTMLButtonElement;
    expect(redeem.disabled).toBe(true);
    expect(container.querySelector('.elig')?.textContent).toContain('3 to go');
  });
});
