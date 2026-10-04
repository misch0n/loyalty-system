import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Capture which payload builder the overlay calls so we can assert that the
// redeem view encodes the REWARD QR (not the card QR). Hoisted so the vi.mock
// factory (itself hoisted) can reference the spies.
const { cardPayload, rewardScanPayload, toDataUrl } = vi.hoisted(() => ({
  toDataUrl: vi.fn((payload: string) => Promise.resolve(`data:${payload}`)),
  cardPayload: vi.fn((token: string) => `card:${token}`),
  rewardScanPayload: vi.fn(
    (tokens: string[], customerToken: string) => `reward:${tokens.join(',')}@${customerToken}`,
  ),
}));
vi.mock('../../../../qr/encode', () => ({
  cardPayload,
  rewardScanPayload,
  toDataUrl,
}));

import { EnlargedQr } from './EnlargedQr';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  cardPayload.mockClear();
  rewardScanPayload.mockClear();
  toDataUrl.mockClear();
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
    root.render(node);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('EnlargedQr', () => {
  it('plain mode encodes the CARD QR', async () => {
    await mount(<EnlargedQr open onClose={() => {}} token="tok-1" name="Maria" code="c" />);
    expect(cardPayload).toHaveBeenCalledWith('tok-1');
    expect(rewardScanPayload).not.toHaveBeenCalled();
    expect(container.querySelector('.redeem-panel')).toBeNull();
  });

  it('redeem mode encodes the REWARD QR for a single reward', async () => {
    await mount(
      <EnlargedQr
        open
        onClose={() => {}}
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

  it('draws the code as an image', async () => {
    await mount(<EnlargedQr open onClose={() => {}} token="tok-1" name="Maria" code="c" />);
    expect(container.querySelector('img.enlarged-qr-img')?.getAttribute('src')).toBe(
      'data:card:tok-1',
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('says so when the code cannot be drawn, instead of a blank square', async () => {
    toDataUrl.mockRejectedValueOnce(new Error('canvas refused'));
    await mount(<EnlargedQr open onClose={() => {}} token="tok-1" name="Maria" code="c" />);
    expect(container.querySelector('img.enlarged-qr-img')).toBeNull();
    expect(container.querySelector('.enlarged-qr-placeholder')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t draw your code. Close this and open it again.',
    );
  });

  it('reopening draws it again', async () => {
    toDataUrl.mockRejectedValueOnce(new Error('canvas refused'));
    await mount(<EnlargedQr open onClose={() => {}} token="tok-1" name="Maria" code="c" />);
    await act(async () => {
      root.render(<EnlargedQr open={false} onClose={() => {}} token="tok-1" name="Maria" code="c" />);
    });
    await act(async () => {
      root.render(<EnlargedQr open onClose={() => {}} token="tok-1" name="Maria" code="c" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('img.enlarged-qr-img')).not.toBeNull();
  });
});
