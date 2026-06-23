import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CustChip } from './CustChip';

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

describe('CustChip', () => {
  it('renders avatar initial, name, progress and status pill', async () => {
    await mount(<CustChip name="Maria" current={7} total={10} status="scanned" />);
    expect(container.querySelector('.cust')).not.toBeNull();
    expect(container.querySelector('.av')?.textContent).toBe('M');
    expect(container.querySelector('.cn')?.textContent).toBe('Maria');
    expect(container.querySelector('.cs')?.textContent).toBe('7 of 10 cups');
    expect(container.querySelector('.ready')?.textContent).toBe('scanned');
  });

  it('omits the status pill when no status is given', async () => {
    await mount(<CustChip name="Tom" current={1} total={10} />);
    expect(container.querySelector('.ready')).toBeNull();
  });
});
