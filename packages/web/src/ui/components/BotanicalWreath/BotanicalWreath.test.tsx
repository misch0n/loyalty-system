import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BotanicalWreath } from './BotanicalWreath';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BotanicalWreath', () => {
  it('renders a decorative, aria-hidden svg with foliage and a forwarded class', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<BotanicalWreath className="redeem-deco" />);
    });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.classList.contains('redeem-deco')).toBe(true);
    // leaves (paths) + beans (ellipses) + cherries (circles) are all present.
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('ellipse').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0);
  });
});
