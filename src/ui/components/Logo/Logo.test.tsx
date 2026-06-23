import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LogoMark, Lockup } from './Logo';

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

describe('LogoMark', () => {
  it('renders an svg with the mark class', async () => {
    await mount(<LogoMark />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('mark')).toBe(true);
  });

  it('applies the sm modifier when size="sm"', async () => {
    await mount(<LogoMark size="sm" />);
    expect(container.querySelector('svg')?.classList.contains('sm')).toBe(true);
  });
});

describe('Lockup', () => {
  it('renders the mark and word/sub text when provided', async () => {
    await mount(<Lockup word="Ckyka" sub="rewards" />);
    expect(container.querySelector('svg.mark')).not.toBeNull();
    expect(container.querySelector('.word')?.textContent).toBe('Ckyka');
    expect(container.querySelector('.sub')?.textContent).toBe('rewards');
  });

  it('omits word and sub when not provided', async () => {
    await mount(<Lockup />);
    expect(container.querySelector('.word')).toBeNull();
    expect(container.querySelector('.sub')).toBeNull();
  });
});
