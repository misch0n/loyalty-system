import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Qr } from './Qr';

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

describe('Qr', () => {
  it('renders the cream wrapper, code and an img', async () => {
    await mount(<Qr token="abc123" code="CKY · 5YUrTHtx" />);
    expect(container.querySelector('.qrwrap')).not.toBeNull();
    expect(container.querySelector('.qr-code')?.textContent).toBe('CKY · 5YUrTHtx');
    expect(container.querySelector('img.qr')).not.toBeNull();
  });

  it('does not render an in-tile "tap to enlarge" label', async () => {
    await mount(<Qr token="t" code="C" />);
    expect(container.querySelector('.meta')).toBeNull();
    expect(container.textContent).not.toContain('Tap to enlarge');
  });

  it('fires onEnlarge on click and becomes a trigger', async () => {
    const onEnlarge = vi.fn();
    await mount(<Qr token="t" code="C" onEnlarge={onEnlarge} />);
    const wrap = container.querySelector('.qrwrap') as HTMLElement;
    expect(wrap.classList.contains('qr-trigger')).toBe(true);
    expect(wrap.getAttribute('role')).toBe('button');
    await act(async () => {
      wrap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onEnlarge).toHaveBeenCalledTimes(1);
  });
});
