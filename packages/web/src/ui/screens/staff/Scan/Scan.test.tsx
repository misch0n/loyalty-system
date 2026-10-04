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
import { ApiError } from '../../../../services/errors';
import { startScanner } from '../../../../qr/scan';
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
    staff: {
      session: vi
        .fn()
        .mockResolvedValue({ status: 'active', actor: STAFFER, epoch: 1, remembered: false }),
    },
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
      ...overrides,
    },
    customers: { provisionFromToken: vi.fn() },
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

function lineButton(label: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button.btn-line')).find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement;
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

  it('holds the staged transaction instead of committing immediately', async () => {
    const services = fakeServices();
    await mountScan(services);
    await inject('PROTOcard0000000000001');

    await click(forestButton('Add 1 coffee'));

    // Nothing written — the hold summarizes what is ABOUT to be saved.
    expect(services.loyalty.commit).not.toHaveBeenCalled();
    expect(container.querySelector('.staff-scan__hold')).not.toBeNull();
    expect(container.querySelector('.staff-scan__hold-list')?.textContent).toContain('Add 1 coffee');
    expect(container.querySelector('.staff-scan__hold-count')?.textContent).toContain('Saving in');
    expect(lineButton('Cancel')).toBeDefined();
    expect(forestButton('Commit now')).toBeDefined();
  });

  it('writes nothing when the hold is cancelled', async () => {
    const services = fakeServices();
    await mountScan(services);
    await inject('PROTOcard0000000000001');

    await click(forestButton('Add 1 coffee'));
    await click(lineButton('Cancel'));

    expect(services.loyalty.commit).not.toHaveBeenCalled();
    // Back on the counter panel, nothing lost.
    expect(container.querySelector('.staff-scan__hold')).toBeNull();
    expect(forestButton('Add 1 coffee')).toBeDefined();
  });

  it('commits once when the hold elapses and returns to the counter', async () => {
    vi.useFakeTimers();
    try {
      const services = fakeServices();
      await mountScan(services);
      await inject('PROTOcard0000000000001');

      await click(forestButton('Add 1 coffee'));
      expect(services.loyalty.commit).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3200);
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

      // S2: the terminal returns to the counter, not to the camera — and says
      // what was saved on the way.
      expect(container.textContent).toContain('STAFF PANEL');
      expect(container.querySelector('.scanview')).toBeNull();
      expect(container.querySelector('.cust')).toBeNull();
      expect(container.querySelector('.toast')?.textContent).toContain('Maria: Added 1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Commit now" submits before the hold elapses, exactly once', async () => {
    const services = fakeServices();
    await mountScan(services);
    await inject('PROTOcard0000000000001');

    await click(forestButton('Add 1 coffee'));
    await click(forestButton('Commit now'));

    expect(services.loyalty.commit).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('STAFF PANEL');
  });

  it('offers no post-commit reversal affordance', async () => {
    const services = fakeServices();
    await mountScan(services);
    await inject('PROTOcard0000000000001');

    await click(forestButton('Add 1 coffee'));
    await click(forestButton('Commit now'));

    expect(
      Array.from(container.querySelectorAll('button')).some((b) => /undo/i.test(b.textContent ?? '')),
    ).toBe(false);
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
    await click(forestButton('Redeem 1'));

    // The hold names the redemption before anything is written.
    expect(container.querySelector('.staff-scan__hold-list')?.textContent).toContain(
      'Redeem 1 free coffee',
    );
    await click(forestButton('Commit now'));

    const commit = services.loyalty.commit as ReturnType<typeof vi.fn>;
    expect(commit.mock.calls[0][1]).toMatchObject({
      pointsDelta: 0,
      redeemRewardIds: ['rw1'],
    });
  });

  it('previews the reward a staged commit will earn', async () => {
    // 9 of 10 + 1 coffee crosses the threshold → one reward minted on commit.
    const services = fakeServices({
      getStateByToken: vi.fn().mockResolvedValue(stateFor(9)),
      getState: vi.fn().mockResolvedValue(stateFor(9)),
    });
    await mountScan(services);
    await inject('PROTOcard0000000000001');

    await click(forestButton('Add 1 coffee'));

    expect(container.querySelector('.staff-scan__hold-earn')?.textContent).toContain(
      'earns 1 free coffee',
    );
    expect(services.loyalty.commit).not.toHaveBeenCalled();
  });

  it('surfaces an over_cap refusal with the real limit and what was attempted', async () => {
    // The server's limit dropped to 1 since the card was read: the re-read names it.
    const lowered = { ...stateFor(7), config: { ...CONFIG, maxPointsPerTransaction: 1 } };
    const getState = vi.fn().mockResolvedValueOnce(stateFor(7)).mockResolvedValue(lowered);
    const services = fakeServices({
      getState,
      commit: vi.fn().mockResolvedValue({ ok: false, error: 'over_cap' }),
    });
    await mountScan(services);
    await inject(TOKEN);

    await setSlider('2');
    await click(forestButton('Add 2 coffees'));
    await click(forestButton('Commit now'));
    await settle();

    // Rejection drops back to the counter panel with the error shown.
    expect(errorText()).toContain('You tried to add 2 — the limit is 1 per scan.');
    expect(container.querySelector('.staff-scan__hold')).toBeNull();
    // …and the slider follows the real limit.
    expect(forestButton('Add 1 coffee')).toBeDefined();
  });

  it('says the card is gone when the commit finds no customer', async () => {
    const services = fakeServices({
      commit: vi.fn().mockResolvedValue({ ok: false, error: 'customer_not_found' }),
    });
    await mountScan(services);
    await inject(TOKEN);
    await click(forestButton('Add 1 coffee'));
    await click(forestButton('Commit now'));

    expect(errorText()).toContain('No card matches that code any more. Scan it again.');
  });

  describe('scanning failures', () => {
    it('an unreadable QR makes no request and keeps the camera on', async () => {
      const services = fakeServices();
      await mountScan(services);
      await inject('https://example.com/menu');

      expect(services.loyalty.getStateByToken).not.toHaveBeenCalled();
      expect(container.querySelector('.scanview')).not.toBeNull();
      expect(container.querySelector('.staff-scan__scan-error')?.textContent).toContain(
        'Couldn’t read that code',
      );
      // The camera was never stopped and restarted.
      expect(startScanner).toHaveBeenCalledTimes(1);
    });

    it('a malformed typed code is refused on the field, with no request', async () => {
      const services = fakeServices();
      await mountScan(services);
      await typeAndSubmit('K39X');

      expect(services.loyalty.getStateByShortCode).not.toHaveBeenCalled();
      expect(container.querySelector('.staff-scan__field-error')?.textContent).toBe(
        'A card code is 8 letters and numbers, like K39X-Q4T7.',
      );
      expect(manualInput().getAttribute('aria-invalid')).toBe('true');
    });

    it('a well-formed typed code is normalized and looked up', async () => {
      const services = fakeServices();
      await mountScan(services);
      await typeAndSubmit('k39x-q4t7');

      expect(services.loyalty.getStateByShortCode).toHaveBeenCalledWith('K39XQ4T7');
      expect(container.querySelector('.cust .cn')?.textContent).toBe('Maria');
    });

    it('a lookup that cannot reach the server keeps scanning — it is not "not registered"', async () => {
      const services = fakeServices({
        getStateByToken: vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' })),
      });
      await mountScan(services);
      await inject(TOKEN);
      await settle();

      expect(container.textContent).not.toContain('No card matches that code');
      expect(container.querySelector('.scanview')).not.toBeNull();
      expect(container.querySelector('.staff-scan__scan-error')?.textContent).toContain(
        'Couldn’t reach the till system',
      );
      // The camera was stopped for the lookup and started again after it.
      expect(startScanner).toHaveBeenCalledTimes(2);
    });

    it('a typed lookup that fails keeps the code and says why on the field', async () => {
      const services = fakeServices({
        getStateByShortCode: vi
          .fn()
          .mockRejectedValue(new ApiError({ kind: 'server', status: 503 })),
      });
      await mountScan(services);
      await typeAndSubmit('K39X-Q4T7');
      await settle();

      expect(manualInput().value).toBe('K39X-Q4T7');
      expect(container.querySelector('.staff-scan__field-error')?.textContent).toContain(
        'The till system had a problem',
      );
      expect(container.querySelector('.scanview')).not.toBeNull();
    });

    it('a lookup that finds nothing says so and asks them to check they registered', async () => {
      const services = fakeServices({ getStateByToken: vi.fn().mockResolvedValue(null) });
      await mountScan(services);
      await inject(TOKEN);

      expect(container.querySelector('.cust .cn')?.textContent).toBe('No card matches that code');
      expect(container.querySelector('.staff-scan__hint')?.textContent).toContain(
        'check they’ve registered',
      );
    });

    it('a blocked camera points at the card-code field', async () => {
      vi.mocked(startScanner).mockRejectedValueOnce(
        new DOMException('Permission denied', 'NotAllowedError'),
      );
      await mountScan(fakeServices());
      await settle();

      expect(container.querySelector('.staff-scan__camera-error')?.textContent).toContain(
        'Camera access is blocked',
      );
      expect(document.activeElement).toBe(manualInput());
    });

    it('a missing camera says so and points at the card-code field', async () => {
      vi.mocked(startScanner).mockRejectedValueOnce(
        new Error('NotFoundError: Requested device not found'),
      );
      await mountScan(fakeServices());
      await settle();

      expect(container.querySelector('.staff-scan__camera-error')?.textContent).toContain(
        'There’s no camera available',
      );
      expect(document.activeElement).toBe(manualInput());
    });
  });

  describe('commit failures', () => {
    it('keeps the staged transaction when the till system cannot be reached, and retries with the SAME key', async () => {
      const commit = vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ kind: 'offline' }))
        .mockRejectedValueOnce(new ApiError({ kind: 'server', status: 502 }))
        .mockResolvedValue({
          ok: true,
          state: stateFor(8),
          minted: [],
          redeemed: [],
          rejected: [],
          replayed: true,
        });
      const services = fakeServices({ commit });
      await mountScan(services);
      await inject(TOKEN);

      await click(forestButton('Add 1 coffee'));
      await click(forestButton('Commit now'));

      // Not thrown away: what was staged is still on screen, with the reason.
      expect(container.textContent).not.toContain('STAFF PANEL');
      expect(container.querySelector('.staff-scan__unsent .staff-scan__hold-list')?.textContent).toContain(
        'Add 1 coffee',
      );
      expect(errorText()).toContain('Couldn’t reach the till system, so this may not have saved.');

      // A second failure keeps it too.
      await click(forestButton('Try again'));
      expect(errorText()).toContain('The till system had a problem, so this may not have saved.');
      expect(container.querySelector('.staff-scan__unsent')).not.toBeNull();

      // Third time lucky — and every send used the one key allocated at stage time.
      await click(forestButton('Try again'));
      expect(commit).toHaveBeenCalledTimes(3);
      const keys = commit.mock.calls.map((call) => call[1].idempotencyKey);
      expect(new Set(keys).size).toBe(1);
      expect(commit.mock.calls[2][1]).toMatchObject({ pointsDelta: 1, redeemRewardIds: [] });
      expect(container.textContent).toContain('STAFF PANEL');
    });

    it('counts a rate-limited commit down before Try again comes back', async () => {
      vi.useFakeTimers();
      try {
        const commit = vi
          .fn()
          .mockRejectedValueOnce(new ApiError({ kind: 'rate_limited', retryAfterSec: 12 }))
          .mockResolvedValue({
            ok: true,
            state: stateFor(8),
            minted: [],
            redeemed: [],
            rejected: [],
            replayed: false,
          });
        const services = fakeServices({ commit });
        await mountScan(services);
        await inject(TOKEN);
        await click(forestButton('Add 1 coffee'));
        await click(forestButton('Commit now'));

        expect(errorText()).toContain('Too many saves in a row');
        const waiting = forestButton('Try again');
        expect(waiting.disabled).toBe(true);
        expect(waiting.textContent).toBe('Try again in 12 s');

        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
        expect(forestButton('Try again').textContent).toBe('Try again in 7 s');

        await act(async () => {
          await vi.advanceTimersByTimeAsync(7000);
        });
        const ready = forestButton('Try again');
        expect(ready.disabled).toBe(false);
        expect(ready.textContent).toBe('Try again');

        await click(ready);
        expect(commit).toHaveBeenCalledTimes(2);
        expect(commit.mock.calls[1][1].idempotencyKey).toBe(commit.mock.calls[0][1].idempotencyKey);
        expect(container.textContent).toContain('STAFF PANEL');
      } finally {
        vi.useRealTimers();
      }
    });

    it('Discard drops the unsent transaction and says how to check whether it landed', async () => {
      const services = fakeServices({
        commit: vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' })),
      });
      await mountScan(services);
      await inject(TOKEN);
      await click(forestButton('Add 1 coffee'));
      await click(forestButton('Commit now'));

      await click(lineButton('Discard'));

      expect(services.loyalty.commit).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.staff-scan__unsent')).toBeNull();
      expect(container.querySelector('.cust .cn')?.textContent).toBe('Maria');
      expect(container.querySelector('.staff-scan__notice')?.textContent).toContain(
        'the customer’s card already shows it',
      );
      // Back on the counter: a fresh stage is possible.
      expect(forestButton('Add 1 coffee').disabled).toBe(false);
    });

    it('a refused commit (not a connection problem) goes back to the counter with the reason', async () => {
      const services = fakeServices({
        commit: vi
          .fn()
          .mockRejectedValue(new ApiError({ kind: 'forbidden', code: 'csrf_failed' })),
      });
      await mountScan(services);
      await inject(TOKEN);
      await click(forestButton('Add 1 coffee'));
      await click(forestButton('Commit now'));

      expect(container.querySelector('.staff-scan__unsent')).toBeNull();
      expect(errorText()).toContain('This page is out of date');
      expect(container.querySelector('.toast')).toBeNull();
    });

    it('a saved commit with refused rewards stays on screen and names them', async () => {
      const services = fakeServices({
        getStateByToken: vi.fn().mockResolvedValue(stateFor(3, [reward('rw1', 'rtok1')])),
        getState: vi.fn().mockResolvedValue(stateFor(3, [reward('rw1', 'rtok1')])),
        commit: vi.fn().mockResolvedValue({
          ok: true,
          state: stateFor(4),
          minted: [],
          redeemed: [],
          rejected: [{ rewardId: 'rw1', reason: 'already_spent' }],
          replayed: false,
        }),
      });
      await mountScan(services);
      await inject('/r?ids=rtok1&c=' + TOKEN);

      // Tick a coffee as well, so something does save.
      await setSlider('1');
      await click(forestButton('Add 1 coffee · Redeem 1'));
      await click(forestButton('Commit now'));

      expect(container.textContent).not.toContain('STAFF PANEL');
      expect(container.querySelector('.toast')).toBeNull();
      const result = container.querySelector('.staff-scan__result');
      expect(result?.querySelector('.staff-scan__saved-list')?.textContent).toContain('Added 1 coffee');
      expect(result?.querySelector('.staff-scan__refused')?.textContent).toBe(
        'Free coffee · ABCD-1234 — already used',
      );
      expect(container.querySelector('.cust .cs')?.textContent).toBe('4 of 10 cups');

      expect(container.querySelector('.staff-scan__result')?.textContent).toContain(
        'Everything else above was saved.',
      );

      await click(forestButton('Back to counter'));
      expect(container.textContent).toContain('STAFF PANEL');
    });

    it('a refusal on Try again, after an unanswered send, still says it may have saved', async () => {
      const commit = vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ kind: 'offline' }))
        .mockRejectedValueOnce(new ApiError({ kind: 'forbidden', code: 'csrf_failed' }));
      const services = fakeServices({ commit });
      await mountScan(services);
      await inject(TOKEN);
      await click(forestButton('Add 1 coffee'));
      await click(forestButton('Commit now'));
      await click(forestButton('Try again'));

      expect(commit).toHaveBeenCalledTimes(2);
      expect(container.querySelector('.staff-scan__unsent')).toBeNull();
      expect(errorText()).toContain('This page is out of date');
      expect(container.querySelector('.staff-scan__notice')?.textContent).toContain(
        'If the first try did save, the customer’s card already shows it',
      );
    });

    it('a refusal on the FIRST send carries no "may have saved" notice', async () => {
      const services = fakeServices({
        commit: vi.fn().mockRejectedValue(new ApiError({ kind: 'forbidden', code: 'csrf_failed' })),
      });
      await mountScan(services);
      await inject(TOKEN);
      await click(forestButton('Add 1 coffee'));
      await click(forestButton('Commit now'));

      expect(container.querySelector('.staff-scan__notice')).toBeNull();
    });

    it('sends once when "Commit now" is still in flight as the hold elapses', async () => {
      vi.useFakeTimers();
      try {
        let answer: (value: unknown) => void = () => undefined;
        const commit = vi.fn(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        );
        const services = fakeServices({ commit });
        await mountScan(services);
        await inject(TOKEN);
        await click(forestButton('Add 1 coffee'));
        await click(forestButton('Commit now'));

        // Cancel is too late now: disabled while the send is in flight.
        expect(lineButton('Cancel').disabled).toBe(true);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(3500);
        });
        expect(commit).toHaveBeenCalledTimes(1);

        await act(async () => {
          answer({ ok: true, state: stateFor(8), minted: [], redeemed: [], rejected: [], replayed: false });
        });
        await settle();
        expect(commit).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('STAFF PANEL');
      } finally {
        vi.useRealTimers();
      }
    });

    it('blocks staging anew while a rate-limit countdown runs', async () => {
      vi.useFakeTimers();
      try {
        const services = fakeServices({
          commit: vi
            .fn()
            .mockRejectedValue(new ApiError({ kind: 'rate_limited', retryAfterSec: 10 })),
        });
        await mountScan(services);
        await inject(TOKEN);
        await click(forestButton('Add 1 coffee'));
        await click(forestButton('Commit now'));
        await click(lineButton('Discard'));

        const stage = forestButton('Add 1 coffee');
        expect(stage.disabled).toBe(true);
        expect(stage.textContent).toBe('Add 1 coffee — wait 10 s');
        // Only the rate-limited send happened: no "may have saved" notice.
        expect(container.querySelector('.staff-scan__notice')).toBeNull();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(forestButton('Add 1 coffee').disabled).toBe(false);
        expect(forestButton('Add 1 coffee').textContent).toBe('Add 1 coffee');
      } finally {
        vi.useRealTimers();
      }
    });

    it('"Scan next" from the refusal screen goes back to the camera', async () => {
      const services = fakeServices({
        getStateByToken: vi.fn().mockResolvedValue(stateFor(3, [reward('rw1', 'rtok1')])),
        getState: vi.fn().mockResolvedValue(stateFor(3, [reward('rw1', 'rtok1')])),
        commit: vi.fn().mockResolvedValue({
          ok: true,
          state: stateFor(3),
          minted: [],
          redeemed: [],
          rejected: [{ rewardId: 'rw1', reason: 'not_owner' }],
          replayed: false,
        }),
      });
      await mountScan(services);
      await inject('/r?ids=rtok1&c=' + TOKEN);
      await click(forestButton('Redeem 1'));
      await click(forestButton('Commit now'));

      expect(container.querySelector('.staff-scan__saved')?.textContent).toBe('Nothing was saved.');
      expect(container.querySelector('.staff-scan__refused')?.textContent).toContain('not on this card');
      // Nothing saved → no "Saved" heading and no "everything else was saved".
      const leads = Array.from(container.querySelectorAll('.staff-scan__hold-lead')).map(
        (el) => el.textContent,
      );
      expect(leads).toEqual(['Not redeemed']);
      expect(container.querySelector('.staff-scan__result')?.textContent).not.toContain(
        'Everything else',
      );

      await click(lineButton('Scan next'));
      expect(container.querySelector('.scanview')).not.toBeNull();
    });
  });
});

const TOKEN = 'PROTOcard0000000000001';

function errorText(): string {
  return Array.from(container.querySelectorAll('.staff-scan__error'))
    .map((el) => el.textContent ?? '')
    .join(' ');
}

function manualInput(): HTMLInputElement {
  return container.querySelector('.staff-scan__manual input') as HTMLInputElement;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function setSlider(value: string) {
  const slider = container.querySelector('.assign input[type=range]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(slider, value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function typeAndSubmit(code: string) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(manualInput(), code);
    manualInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector('.staff-scan__manual')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}
