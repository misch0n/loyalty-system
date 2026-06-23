import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StateLabel } from './StateLabel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('StateLabel', () => {
  it('renders .state-label with its text', async () => {
    await mount(<StateLabel>state 1 · scanning</StateLabel>);
    const el = container.querySelector('.state-label');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('state 1 · scanning');
  });
});
