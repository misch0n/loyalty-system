import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScanView } from './ScanView';

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

describe('ScanView', () => {
  it('renders the frame, four corners, laser and caption', async () => {
    await mount(<ScanView caption="Point at the customer's code" />);
    expect(container.querySelector('.scanview')).not.toBeNull();
    expect(container.querySelectorAll('.scanview .frame i').length).toBe(4);
    expect(container.querySelector('.laser')).not.toBeNull();
    expect(container.querySelector('.cap')?.textContent).toBe("Point at the customer's code");
  });

  it('mounts the live camera node when videoSlot is given', async () => {
    await mount(<ScanView videoSlot={<div id="cam-region" />} />);
    expect(container.querySelector('.scanview__video #cam-region')).not.toBeNull();
  });
});
