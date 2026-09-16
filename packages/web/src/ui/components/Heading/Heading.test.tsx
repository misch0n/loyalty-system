import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Eyebrow, Title, Sub } from './Heading';

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

describe('Heading', () => {
  it('renders eyebrow text with the right class', async () => {
    await mount(<Eyebrow>Ckyka rewards</Eyebrow>);
    const el = container.querySelector('.h-eyebrow');
    expect(el?.textContent).toBe('Ckyka rewards');
  });

  it('renders the title and merges className', async () => {
    await mount(<Title className="center">Join the club</Title>);
    const el = container.querySelector('.h-title');
    expect(el?.textContent).toBe('Join the club');
    expect(el?.classList.contains('center')).toBe(true);
  });

  it('renders the sub line', async () => {
    await mount(<Sub>One tap is enough.</Sub>);
    expect(container.querySelector('.h-sub')?.textContent).toBe('One tap is enough.');
  });
});
