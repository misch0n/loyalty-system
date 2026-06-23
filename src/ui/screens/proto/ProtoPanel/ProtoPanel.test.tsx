import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ProtoPanel } from './ProtoPanel';
import { ServicesProvider } from '../../../common/ServicesContext';
import { PRESET_CARD_TOKENS } from '../../../../wallet/passes';
import type { Services } from '../../../../services/Services';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Navigation spy — captures the last path a control routed to.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// Pairing + auth are external wiring (PeerJS / sessionStorage) — stub them.
vi.mock('../../../common/PairingContext', () => ({
  usePairing: () => ({
    peerId: null,
    clientCount: 0,
    joined: false,
    ensureHosting: vi.fn(),
    unpair: vi.fn(),
  }),
}));
vi.mock('../../../app/AuthContext', () => ({
  useAuth: () => ({ actor: null }),
}));

const resetMock = vi.fn(async () => {});
const services = { reset: resetMock } as unknown as Services;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigateMock.mockReset();
  resetMock.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function mount(open = true): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ServicesProvider value={services}>
          <ProtoPanel open={open} onClose={() => {}} />
        </ServicesProvider>
      </MemoryRouter>,
    );
  });
}

describe('ProtoPanel', () => {
  it('renders nothing when closed', async () => {
    await mount(false);
    expect(container.querySelector('.proto')).toBeNull();
  });

  it('renders the Prototype badge and demo control groups', async () => {
    await mount();
    expect(container.querySelector('.badge')?.textContent).toBe('Prototype');
    const labels = Array.from(container.querySelectorAll('.lab')).map((n) => n.textContent);
    expect(labels.some((l) => l?.startsWith('Active customer'))).toBe(true);
    expect(labels).toContain('Jump card state');
    expect(labels).toContain('Data');
    expect(labels).toContain('Jump to view');
    expect(labels).toContain('Device pairing');
  });

  it('reset calls services.reset', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // jsdom's location is non-configurable; swap in a stub so reset()'s
    // hash-set + reload don't blow up the test.
    const realLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, hash: '', reload: vi.fn() },
    });
    await mount();
    const resetBtn = Array.from(container.querySelectorAll('.pbtn')).find((b) =>
      b.textContent?.includes('Reset'),
    ) as HTMLButtonElement;
    await act(async () => {
      resetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(resetMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: realLocation,
    });
  });

  it('selecting a demo customer navigates to its card', async () => {
    await mount();
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = PRESET_CARD_TOKENS[1];
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(navigateMock).toHaveBeenCalledWith(
      `/card/${encodeURIComponent(PRESET_CARD_TOKENS[1])}`,
    );
  });

  it('"Jump to view · Staff" navigates to the staff route', async () => {
    await mount();
    const staffBtn = Array.from(container.querySelectorAll('.pbtn')).find(
      (b) => b.textContent === 'Staff',
    ) as HTMLButtonElement;
    await act(async () => {
      staffBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(navigateMock).toHaveBeenCalledWith('/staff');
  });
});
