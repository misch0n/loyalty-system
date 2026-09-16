import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContextBanner } from './ContextBanner';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

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
}

describe('ContextBanner', () => {
  it('renders children inside .ct', async () => {
    await mount(<ContextBanner>Remember this card?</ContextBanner>);
    expect(container.querySelector('.context-banner .ct')?.textContent).toBe(
      'Remember this card?',
    );
  });

  it('omits the sage class by default and applies it for the sage tone', async () => {
    await mount(<ContextBanner tone="sage">x</ContextBanner>);
    expect(container.querySelector('.context-banner')?.classList.contains('sage')).toBe(true);
  });

  it('renders a toggle into the .tog slot', async () => {
    await mount(<ContextBanner toggle={<span className="probe">t</span>}>x</ContextBanner>);
    expect(container.querySelector('.tog .probe')?.textContent).toBe('t');
  });
});
