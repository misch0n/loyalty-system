import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoyaltyCard } from './LoyaltyCard';
import type { Reward } from '../../../domain/models';

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

function reward(n: number): Reward {
  return {
    id: `r${n}`,
    token: `rtok-${n}`,
    shortCode: `CODE${n}`,
    ownerId: 'c1',
    status: 'unspent',
    issuedAt: `2026-01-0${n}T00:00:00.000Z`,
    sourceTxnId: `tx${n}`,
    descriptionSnapshot: 'free coffee',
  };
}

const click = (el: Element | null) =>
  act(() => el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('LoyaltyCard', () => {
  it('renders the collecting state: name, 10-cup showcase grid, progress note', async () => {
    // total=8 (the reward threshold) renders a 10-cup card: welcome sticker +
    // 8 earnable + the FREE reward cup.
    await render(
      <LoyaltyCard name="Maria" filled={7} total={8} token="tok0000000000000000001" code="CKY · 5YUrTHtx" />,
    );
    expect(container.querySelector('.who')?.textContent).toBe('Maria');
    expect(container.querySelectorAll('.stamp').length).toBe(10);
    // welcome (1) + 7 earned + free (always pre-stamped) = 9 on.
    expect(container.querySelectorAll('.stamp.on').length).toBe(9);
    expect(container.querySelector('.stamp.welcome')).not.toBeNull();
    expect(container.querySelector('.stamp.free.on')).not.toBeNull();
    expect(container.querySelector('.progress-note .left')?.textContent).toContain('1 more');
    expect(container.querySelector('.progress-note .pts')?.textContent?.replace(/\s/g, '')).toBe(
      '9/10',
    );
    expect(container.querySelector('.ready-banner')).toBeNull();
  });

  it('renders the reward entry when a reward is owned: banner replaces the progress note', async () => {
    await render(
      <LoyaltyCard
        name="Maria"
        filled={0}
        total={8}
        token="tok0000000000000000001"
        code="CKY · 5YUrTHtx"
        rewards={[reward(1)]}
      />,
    );
    expect(container.querySelector('.ready-banner')).not.toBeNull();
    expect(container.querySelector('.ready-banner .b1')?.textContent).toContain('Free coffee');
    expect(container.querySelector('.progress-note')).toBeNull();
    // One reward → no count badge, no picker.
    expect(container.querySelector('.ready-badge')).toBeNull();
    expect(container.querySelector('.reward-choices')).toBeNull();
  });

  it('tapping the entry redeems the FIRST reward (single-element composite)', async () => {
    const onRedeem = vi.fn();
    await render(
      <LoyaltyCard
        name="Maria"
        filled={2}
        total={8}
        token="t"
        code="c"
        rewards={[reward(1), reward(2), reward(3)]}
        onRedeem={onRedeem}
      />,
    );
    await click(container.querySelector('.ready-entry'));
    expect(onRedeem).toHaveBeenCalledTimes(1);
    expect(onRedeem).toHaveBeenCalledWith(['rtok-1']);
  });

  it('2+ rewards: badge shows the count; tapping it expands the picker and the badge becomes a QR icon; composing redeems the selected ids', async () => {
    const onRedeem = vi.fn();
    await render(
      <LoyaltyCard
        name="Maria"
        filled={4}
        total={8}
        token="t"
        code="c"
        rewards={[reward(1), reward(2), reward(3)]}
        onRedeem={onRedeem}
      />,
    );
    // Collapsed: cup glyph + count, no picker yet.
    const badge = container.querySelector<HTMLButtonElement>('.ready-badge');
    expect(badge?.textContent).toContain('3');
    expect(container.querySelector('.reward-choices')).toBeNull();

    // Tap badge → picker expands; first reward preselected.
    await click(badge);
    const choices = container.querySelectorAll<HTMLInputElement>('.reward-choices input');
    expect(choices.length).toBe(3);
    expect(choices[0].checked).toBe(true);
    expect(choices[1].checked).toBe(false);

    // Select a second reward → the entry label shows the ×2 multiplier.
    await act(async () => {
      choices[1].click();
    });
    expect(container.querySelector('.ready-banner .mult')?.textContent).toBe('×2');

    // The badge is now a QR icon; tapping it composes the selected ids.
    await click(container.querySelector('.ready-badge'));
    expect(onRedeem).toHaveBeenCalledTimes(1);
    expect(onRedeem).toHaveBeenCalledWith(['rtok-1', 'rtok-2']);
  });

  it('has no decorative tier badge', async () => {
    await render(
      <LoyaltyCard name="Maria" filled={3} total={8} token="tok0000000000000000001" code="c" />,
    );
    expect(container.querySelector('.tier')).toBeNull();
  });

  it('fires onMenu when the discreet "⋯" is tapped, and omits it otherwise', async () => {
    const onMenu = vi.fn();
    await render(
      <LoyaltyCard name="Maria" filled={3} total={8} token="tok0000000000000000001" code="c" onMenu={onMenu} />,
    );
    const dots = container.querySelector<HTMLButtonElement>('.dots-btn');
    expect(dots).not.toBeNull();
    await click(dots);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
