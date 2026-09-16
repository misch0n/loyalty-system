import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider, useToast, type ToastApi } from './Toast';

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

function Harness({ apiRef }: { apiRef: { current: ToastApi | null } }) {
  apiRef.current = useToast();
  return null;
}

describe('Toast', () => {
  it('renders queued text in a .toast pill', async () => {
    const apiRef: { current: ToastApi | null } = { current: null };
    await mount(
      <ToastProvider>
        <Harness apiRef={apiRef} />
      </ToastProvider>,
    );
    await act(async () => {
      apiRef.current?.show('Added 2 · Maria now at 9 / 10', { duration: 0 });
    });
    const toast = container.querySelector('.toast');
    expect(toast?.textContent).toBe('Added 2 · Maria now at 9 / 10');
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
  });

  it('throws when useToast is used outside a provider', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const apiRef: { current: ToastApi | null } = { current: null };
    await expect(mount(<Harness apiRef={apiRef} />)).rejects.toThrow(
      /useToast must be used within/,
    );
    spy.mockRestore();
  });
});
