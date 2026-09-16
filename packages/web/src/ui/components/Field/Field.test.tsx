import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Field, Consent, Toggle } from './Field';

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

describe('Field', () => {
  it('renders label, optional badge and hint', async () => {
    await mount(<Field label="Email" optional hint="So we can reach you." />);
    expect(container.querySelector('label')?.textContent).toContain('Email');
    expect(container.querySelector('.opt')?.textContent).toBe('optional');
    expect(container.querySelector('.hint')?.textContent).toBe('So we can reach you.');
    expect(container.querySelector('input.ip')).not.toBeNull();
  });

  it('forwards input changes as a string', async () => {
    const onChange = vi.fn();
    await mount(<Field label="Name" value="" onChange={onChange} />);
    const input = container.querySelector('input.ip') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'Maria');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('Maria');
  });
});

describe('Consent', () => {
  it('toggles on click', async () => {
    const onChange = vi.fn();
    await mount(
      <Consent checked={false} onChange={onChange}>
        I agree
      </Consent>,
    );
    await act(async () => {
      container.querySelector('.consent-box')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('keeps the box as the only toggle so the label can hold a link', async () => {
    await mount(
      <Consent checked={false} onChange={() => {}}>
        I agree to the <button type="button">privacy notice</button>
      </Consent>,
    );
    // The consent wrapper is no longer a button (no nested-button), so an
    // interactive element in the label is valid.
    expect(container.querySelector('.consent')?.tagName).toBe('DIV');
    expect(container.querySelector('.consent-box')?.getAttribute('role')).toBe('checkbox');
  });
});

describe('Toggle', () => {
  it('applies the on class when active and toggles', async () => {
    const onChange = vi.fn();
    await mount(<Toggle on onChange={onChange} label="Remember" />);
    expect(container.querySelector('.toggle-box')?.classList.contains('on')).toBe(true);
    await act(async () => {
      container.querySelector('[role="switch"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
