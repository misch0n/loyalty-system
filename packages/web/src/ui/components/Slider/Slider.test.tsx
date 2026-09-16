import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PointsSlider } from './Slider';

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

describe('PointsSlider', () => {
  it('renders the value in .aval', async () => {
    await mount(<PointsSlider value={2} onChange={() => {}} max={3} />);
    expect(container.querySelector('.aval')?.textContent).toBe('2');
  });

  it('renders one tick per step from min..max', async () => {
    await mount(<PointsSlider value={1} onChange={() => {}} max={3} />);
    expect(container.querySelectorAll('.ticks span').length).toBe(3);
  });

  it('sets the --p fill percentage on the input', async () => {
    await mount(<PointsSlider value={2} onChange={() => {}} min={1} max={3} />);
    const input = container.querySelector('input[type=range]') as HTMLInputElement;
    // (2-1)/(3-1) = 50%
    expect(input.style.getPropertyValue('--p')).toBe('50%');
  });

  it('fires onChange with the new numeric value', async () => {
    const onChange = vi.fn();
    await mount(<PointsSlider value={1} onChange={onChange} max={3} />);
    const input = container.querySelector('input[type=range]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    act(() => {
      setValue?.call(input, '3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
