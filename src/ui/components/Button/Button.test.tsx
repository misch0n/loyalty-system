import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Button, WalletButton } from './Button';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
}

describe('Button', () => {
  it('defaults to the forest variant', async () => {
    await mount(<Button>Add points</Button>);
    const btn = container.querySelector('button');
    expect(btn?.classList.contains('btn')).toBe(true);
    expect(btn?.classList.contains('btn-forest')).toBe(true);
  });

  it('applies the requested variant', async () => {
    await mount(<Button variant="sage">Go</Button>);
    expect(container.querySelector('button')?.classList.contains('btn-sage')).toBe(true);
  });

  it('fires onClick', async () => {
    const onClick = vi.fn();
    await mount(<Button onClick={onClick}>Tap</Button>);
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('blocks clicks when disabled', async () => {
    const onClick = vi.fn();
    await mount(
      <Button onClick={onClick} disabled>
        Tap
      </Button>,
    );
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders an anchor when as="a"', async () => {
    await mount(
      <Button as="a" href="/welcome" variant="line">
        Home
      </Button>,
    );
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('/welcome');
    expect(a?.classList.contains('btn-line')).toBe(true);
  });
});

describe('WalletButton', () => {
  it('renders the Apple label by default', async () => {
    await mount(<WalletButton />);
    const btn = container.querySelector('button.wallet');
    expect(btn?.textContent).toContain('Add to Apple Wallet');
  });

  it('renders the Google label when os="google"', async () => {
    await mount(<WalletButton os="google" />);
    expect(container.querySelector('button.wallet')?.textContent).toContain(
      'Save to Google Wallet',
    );
  });
});
