import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Capture which payload builder the overlay calls so we can assert that the
// redeem view encodes the REWARD QR (not the card QR). Hoisted so the vi.mock
// factory (itself hoisted) can reference the spies.
const { cardPayload, rewardScanPayload } = vi.hoisted(() => ({
  cardPayload: vi.fn((token: string) => `card:${token}`),
  rewardScanPayload: vi.fn(
    (tokens: string[], customerToken: string) => `reward:${tokens.join(',')}@${customerToken}`,
  ),
}));
vi.mock('../../../../qr/encode', () => ({
  cardPayload,
  rewardScanPayload,
  toDataUrl: (payload: string) => Promise.resolve(`data:${payload}`),
}));

vi.mock('../../../../wallet/passes', () => ({
  detectWalletKind: () => 'apple',
}));

import { EnlargedQr } from './EnlargedQr';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const services = {
  wallet: { ensurePass: vi.fn().mockResolvedValue({ appleUrl: 'a', googleUrl: 'g' }) },
} as unknown as Services;

beforeEach(() => {
  cardPayload.mockClear();
  rewardScanPayload.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ServicesProvider value={services}>{node}</ServicesProvider>);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('EnlargedQr', () => {
  it('plain mode encodes the CARD QR (and shows the wallet path)', async () => {
    await mount(
      <EnlargedQr open onClose={() => {}} customerId="c1" token="tok-1" name="Maria" code="c" />,
    );
    expect(cardPayload).toHaveBeenCalledWith('tok-1');
    expect(rewardScanPayload).not.toHaveBeenCalled();
    expect(container.querySelector('.redeem-panel')).toBeNull();
  });

  it('redeem mode encodes the REWARD QR for a single reward', async () => {
    await mount(
      <EnlargedQr
        open
        onClose={() => {}}
        customerId="c1"
        token="tok-1"
        name="Maria"
        code="c"
        redeem
        rewardTokens={['rtok-1']}
      />,
    );
    expect(rewardScanPayload).toHaveBeenCalledWith(['rtok-1'], 'tok-1');
    expect(cardPayload).not.toHaveBeenCalled();
    expect(container.querySelector('.redeem-panel')).not.toBeNull();
    expect(container.querySelector('.redeem-title')?.textContent).toBe('Your free coffee');
  });

  it('redeem mode reads in the plural for a composite of 2+ rewards', async () => {
    await mount(
      <EnlargedQr
        open
        onClose={() => {}}
        customerId="c1"
        token="tok-1"
        name="Maria"
        code="c"
        redeem
        rewardTokens={['rtok-1', 'rtok-2']}
      />,
    );
    expect(rewardScanPayload).toHaveBeenCalledWith(['rtok-1', 'rtok-2'], 'tok-1');
    expect(container.querySelector('.redeem-title')?.textContent).toBe('Your free coffees');
  });
});
