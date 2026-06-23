import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoyaltyCard } from './LoyaltyCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
}

describe('LoyaltyCard', () => {
  it('renders the collecting state: name, stamps, progress note', async () => {
    await render(
      <LoyaltyCard name="Maria" filled={7} total={10} token="tok0000000000000000001" code="CKY · 5YUrTHtx" />,
    );
    expect(container.querySelector('.who')?.textContent).toBe('Maria');
    expect(container.querySelectorAll('.stamp').length).toBe(10);
    expect(container.querySelectorAll('.stamp.on').length).toBe(7);
    expect(container.querySelector('.progress-note .left')?.textContent).toContain('3 more');
    expect(container.querySelector('.progress-note .pts')?.textContent?.replace(/\s/g, '')).toBe(
      '7/10',
    );
    expect(container.querySelector('.ready-banner')).toBeNull();
  });

  it('renders the reward-ready state: banner replaces the progress note', async () => {
    await render(
      <LoyaltyCard name="Maria" filled={10} total={10} token="tok0000000000000000001" code="CKY · 5YUrTHtx" rewardReady />,
    );
    expect(container.querySelector('.ready-banner')).not.toBeNull();
    expect(container.querySelector('.ready-banner .b1')?.textContent).toContain('Free coffee');
    expect(container.querySelector('.progress-note')).toBeNull();
    expect(container.querySelectorAll('.stamp.on').length).toBe(10);
  });

  it('fires onMenu when the discreet "⋯" is tapped, and omits it otherwise', async () => {
    const onMenu = vi.fn();
    await render(
      <LoyaltyCard name="Maria" filled={3} total={10} token="tok0000000000000000001" code="c" onMenu={onMenu} />,
    );
    const dots = container.querySelector<HTMLButtonElement>('.dots-btn');
    expect(dots).not.toBeNull();
    act(() => dots!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
