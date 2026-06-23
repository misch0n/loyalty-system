import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay } from './Overlay';

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

describe('Overlay', () => {
  it('renders nothing when closed', async () => {
    await mount(
      <Overlay open={false} onClose={() => {}}>
        content
      </Overlay>,
    );
    expect(container.querySelector('.qr-enlarge')).toBeNull();
  });

  it('renders children and the close + tap affordances when open', async () => {
    await mount(
      <Overlay open onClose={() => {}} label="Your code">
        <div className="nm">Maria</div>
      </Overlay>,
    );
    expect(container.querySelector('.qr-enlarge')).not.toBeNull();
    expect(container.querySelector('.qr-enlarge .close')).not.toBeNull();
    expect(container.querySelector('.qr-enlarge .tap')).not.toBeNull();
    expect(container.querySelector('.nm')?.textContent).toBe('Maria');
  });

  it('closes on the close button', async () => {
    const onClose = vi.fn();
    await mount(
      <Overlay open onClose={onClose}>
        content
      </Overlay>,
    );
    const close = container.querySelector('.close') as HTMLElement;
    act(() => {
      close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const onClose = vi.fn();
    await mount(
      <Overlay open onClose={onClose}>
        content
      </Overlay>,
    );
    const back = container.querySelector('.qr-enlarge') as HTMLElement;
    act(() => {
      back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    await mount(
      <Overlay open onClose={onClose}>
        content
      </Overlay>,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
