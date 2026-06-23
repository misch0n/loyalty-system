import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PinPad } from './PinPad';

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

function clickKey(k: string) {
  const btn = container.querySelector(`[data-k="${k}"]`) as HTMLElement;
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('PinPad', () => {
  it('lights dots for the entered digits', async () => {
    await mount(<PinPad value="12" onChange={() => {}} />);
    const dots = container.querySelectorAll('.pin-dots i');
    expect(dots.length).toBe(4);
    expect(dots[0].classList.contains('on')).toBe(true);
    expect(dots[1].classList.contains('on')).toBe(true);
    expect(dots[2].classList.contains('on')).toBe(false);
  });

  it('appends a digit on key press', async () => {
    const onChange = vi.fn();
    await mount(<PinPad value="12" onChange={onChange} />);
    clickKey('3');
    expect(onChange).toHaveBeenCalledWith('123');
  });

  it('does not append past the length', async () => {
    const onChange = vi.fn();
    await mount(<PinPad value="1234" onChange={onChange} length={4} />);
    clickKey('5');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a digit on delete', async () => {
    const onChange = vi.fn();
    await mount(<PinPad value="123" onChange={onChange} />);
    clickKey('del');
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('blocks input when disabled', async () => {
    const onChange = vi.fn();
    await mount(<PinPad value="1" onChange={onChange} disabled />);
    clickKey('2');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders an inert blank spacer key and a remember slot', async () => {
    await mount(<PinPad value="" onChange={() => {}} rememberSlot={<span className="rs">remember</span>} />);
    expect(container.querySelector('.key.blank')).not.toBeNull();
    expect(container.querySelector('.remember-row .rs')?.textContent).toBe('remember');
  });
});
