import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sheet, MenuRow } from './Sheet';

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

describe('Sheet', () => {
  it('renders nothing when closed', async () => {
    await mount(
      <Sheet open={false} onClose={() => {}}>
        body
      </Sheet>,
    );
    expect(container.querySelector('.sheet-back')).toBeNull();
  });

  it('renders the sheet with a grab handle when open', async () => {
    await mount(
      <Sheet open onClose={() => {}} label="Card menu">
        <div className="probe">body</div>
      </Sheet>,
    );
    expect(container.querySelector('.sheet-back')).not.toBeNull();
    expect(container.querySelector('.sheet .grab')).not.toBeNull();
    expect(container.querySelector('.probe')?.textContent).toBe('body');
  });

  it('closes on scrim click but not on panel click', async () => {
    const onClose = vi.fn();
    await mount(
      <Sheet open onClose={onClose}>
        body
      </Sheet>,
    );
    const panel = container.querySelector('.sheet') as HTMLElement;
    act(() => {
      panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    const back = container.querySelector('.sheet-back') as HTMLElement;
    act(() => {
      back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drag the handle down past the threshold dismisses; a small drag snaps back', async () => {
    // A long downward drag on the grab zone closes the sheet.
    const onClose = vi.fn();
    await mount(
      <Sheet open onClose={onClose}>
        body
      </Sheet>,
    );
    const drag = container.querySelector('.sheet-drag') as HTMLElement;
    const fire = (type: string, clientY: number) =>
      act(() => {
        drag.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY }));
      });
    fire('pointerdown', 100);
    fire('pointermove', 300); // +200px, past the 110px dismiss threshold
    fire('pointerup', 300);
    expect(onClose).toHaveBeenCalledTimes(1);

    // A short drag does NOT dismiss — the sheet snaps back.
    const onClose2 = vi.fn();
    await mount(
      <Sheet open onClose={onClose2}>
        body
      </Sheet>,
    );
    const drag2 = container.querySelector('.sheet-drag') as HTMLElement;
    const fire2 = (type: string, clientY: number) =>
      act(() => {
        drag2.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY }));
      });
    fire2('pointerdown', 100);
    fire2('pointermove', 150); // +50px, under the threshold
    fire2('pointerup', 150);
    expect(onClose2).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    await mount(
      <Sheet open onClose={onClose}>
        body
      </Sheet>,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('MenuRow', () => {
  it('applies danger and first classes and fires onClick', async () => {
    const onClick = vi.fn();
    await mount(<MenuRow icon={<svg />} title="Delete" subtitle="gone" danger first onClick={onClick} />);
    const row = container.querySelector('.menu-row') as HTMLElement;
    expect(row.classList.contains('danger')).toBe(true);
    expect(row.classList.contains('first')).toBe(true);
    expect(container.querySelector('.mt')?.textContent).toBe('Delete');
    expect(container.querySelector('.ms')?.textContent).toBe('gone');
    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
