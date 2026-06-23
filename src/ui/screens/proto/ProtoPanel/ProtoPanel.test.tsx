import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ProtoPanel } from './ProtoPanel';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Navigation spy — captures the last path a control routed to.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// Pairing is external wiring (PeerJS / sessionStorage) — stub it.
const joinAsMock = vi.fn();
vi.mock('../../../common/PairingContext', () => ({
  usePairing: () => ({
    peerId: null,
    clientCount: 0,
    joined: false,
    connecting: false,
    ensureHosting: vi.fn(),
    joinAs: joinAsMock,
    unpair: vi.fn(),
  }),
}));

// The QR scanner touches the camera — stub it to a trivial trigger.
vi.mock('../../../common/QrScanner', () => ({
  QrScanner: () => <div className="qr-scanner-stub" />,
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

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.pbtn')).find((b) =>
    b.textContent?.includes(text),
  );
}

describe('ProtoPanel', () => {
  it('renders nothing when closed', async () => {
    await mount(false);
    expect(container.querySelector('.proto')).toBeNull();
  });

  it('shows only the three developer controls: QR, scan to pair, reset', async () => {
    await mount();
    expect(container.querySelector('.badge')?.textContent).toBe('Prototype');
    // QR area (status until a peer id arrives), plus the two action buttons.
    expect(container.querySelector('.proto-status')).not.toBeNull();
    expect(findButton('Scan to pair')).toBeTruthy();
    expect(findButton('Reset')).toBeTruthy();
    // The old demo-card / jump-to-view controls are gone.
    expect(container.querySelector('select')).toBeNull();
    expect(findButton('Staff')).toBeUndefined();
    expect(findButton('Admin')).toBeUndefined();
    expect(findButton('Card')).toBeUndefined();
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
    await act(async () => {
      findButton('Reset')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(resetMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: realLocation,
    });
  });

  it('"Scan to pair" opens the in-window camera modal (no navigation)', async () => {
    await mount();
    await act(async () => {
      findButton('Scan to pair')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // A scan modal with the (stubbed) camera scanner appears; we don't navigate.
    expect(document.querySelector('.qr-scanner-stub')).not.toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
