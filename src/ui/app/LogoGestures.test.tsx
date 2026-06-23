import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GestureLogo, LogoGesturesProvider, tapSide } from './LogoGestures';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('tapSide', () => {
  const rect = { left: 100, width: 200 };
  it('left half', () => {
    expect(tapSide(120, rect)).toBe('left');
    expect(tapSide(199, rect)).toBe('left');
  });
  it('right half at/after midpoint', () => {
    expect(tapSide(200, rect)).toBe('right');
    expect(tapSide(260, rect)).toBe('right');
  });
});

describe('GestureLogo', () => {
  let container: HTMLDivElement;
  let root: Root;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  function render(value: { onHome?: () => void; onTools?: () => void; onHold?: () => void }) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <LogoGesturesProvider value={value}>
          <GestureLogo>
            <span>ckyka</span>
          </GestureLogo>
        </LogoGesturesProvider>,
      );
    });
  }

  it('keyboard tap goes home, not tools/hold', () => {
    const onHome = vi.fn();
    const onTools = vi.fn();
    const onHold = vi.fn();
    render({ onHome, onTools, onHold });
    const logo = container.querySelector<HTMLButtonElement>('.logo-gesture')!;
    act(() => {
      logo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      logo.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    });
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onTools).not.toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
  });

  it('exposes a hidden keyboard path to staff sign-in (onHold)', () => {
    const onHold = vi.fn();
    render({ onHome: vi.fn(), onHold });
    const link = container.querySelector<HTMLButtonElement>('.logo-staff-link')!;
    expect(link).not.toBeNull();
    act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('omits the staff link when onHold is not provided', () => {
    render({ onHome: vi.fn() });
    expect(container.querySelector('.logo-staff-link')).toBeNull();
  });
});
