import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { TopBar, OnShift } from './TopBar';

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
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
}

describe('TopBar', () => {
  it('renders the donor topbar classes with the role pill', async () => {
    await mount(<TopBar role="Counter" />);
    expect(container.querySelector('.topbar')).not.toBeNull();
    expect(container.querySelector('.tl')).not.toBeNull();
    expect(container.querySelector('.tt')?.textContent).toBe('Ckyka');
    expect(container.querySelector('.role')?.textContent).toBe('Counter');
  });

  it('renders the on-shift line when onShift is given', async () => {
    await mount(<TopBar onShift="Sam" />);
    expect(container.querySelector('.onshift')?.textContent).toContain('Sam');
  });

  it('OnShift renders the name', async () => {
    await mount(<OnShift name="Maria" />);
    expect(container.querySelector('.onshift')?.textContent).toContain('Maria');
  });
});
