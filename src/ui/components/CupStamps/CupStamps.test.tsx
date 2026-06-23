import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CupStamps } from './CupStamps';

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

describe('CupStamps', () => {
  it('renders total stamps with filled marked .on', async () => {
    await mount(<CupStamps filled={7} total={10} />);
    const stamps = container.querySelectorAll('.stamp');
    expect(stamps.length).toBe(10);
    expect(container.querySelectorAll('.stamp.on').length).toBe(7);
    const grid = container.querySelector('.stamps') as HTMLElement;
    expect(grid.dataset.total).toBe('10');
    expect(grid.dataset.filled).toBe('7');
  });

  it('clamps filled above total', async () => {
    await mount(<CupStamps filled={15} total={10} />);
    expect(container.querySelectorAll('.stamp.on').length).toBe(10);
    expect((container.querySelector('.stamps') as HTMLElement).dataset.filled).toBe('10');
  });

  it('clamps negative filled to zero', async () => {
    await mount(<CupStamps filled={-3} total={5} />);
    expect(container.querySelectorAll('.stamp.on').length).toBe(0);
    expect(container.querySelectorAll('.stamp').length).toBe(5);
  });
});
