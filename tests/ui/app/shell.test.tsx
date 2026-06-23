/**
 * Shell logo-gesture tests.
 *
 * Gestures: tap LEFT half → home, tap RIGHT half → tools (prototype only),
 * hold → staff sign-in. The pointer left/right split is pure (`tapSide`) and
 * tested directly; the keyboard tap (→ home) and the staff-sign-in link
 * (→ hold) are exercised through the rendered Shell.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Shell, tapSide } from '../../../src/ui/app/Shell';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('tapSide', () => {
  const rect = { left: 100, width: 200 }; // midpoint at x = 200

  it('reports left for the left half', () => {
    expect(tapSide(120, rect)).toBe('left');
    expect(tapSide(199, rect)).toBe('left');
  });

  it('reports right at and past the midpoint', () => {
    expect(tapSide(200, rect)).toBe('right');
    expect(tapSide(280, rect)).toBe('right');
  });
});

describe('Shell keyboard + staff link', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: {
    onLogoHome?: () => void;
    onLogoTools?: () => void;
    onLogoHold?: () => void;
  }) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <Shell {...props}>
          <div>content</div>
        </Shell>,
      );
    });
  }

  it('keyboard tap (Enter) goes home, not tools or hold', () => {
    const onLogoHome = vi.fn();
    const onLogoTools = vi.fn();
    const onLogoHold = vi.fn();
    render({ onLogoHome, onLogoTools, onLogoHold });

    const logo = container.querySelector<HTMLButtonElement>('.shell__logo')!;
    act(() => {
      logo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      logo.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    });

    expect(onLogoHome).toHaveBeenCalledTimes(1);
    expect(onLogoTools).not.toHaveBeenCalled();
    expect(onLogoHold).not.toHaveBeenCalled();
  });

  it('renders the staff-sign-in link and routes it to hold', () => {
    const onLogoHold = vi.fn();
    render({ onLogoHome: vi.fn(), onLogoHold });

    const link = container.querySelector<HTMLButtonElement>('.shell__staff-link')!;
    expect(link).toBeTruthy();
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onLogoHold).toHaveBeenCalledTimes(1);
  });
});
