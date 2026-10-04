import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '../../../../../services/errors';
import { ConfirmSheet, type ConfirmSheetProps } from './ConfirmSheet';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)!;
}

async function render(props: Partial<ConfirmSheetProps>) {
  const all: ConfirmSheetProps = {
    open: true,
    onClose: () => {},
    onConfirm: () => {},
    title: 'Do it?',
    message: 'It cannot be undone.',
    confirmLabel: 'Do it',
    ...props,
  };
  await act(async () => {
    root.render(<ConfirmSheet {...all} />);
  });
}

async function confirm() {
  await act(async () => {
    button('Do it').click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ConfirmSheet — a failed confirm (UI-4)', () => {
  it('stays open and says what went wrong, in the admin wording by default', async () => {
    const onClose = vi.fn();
    await render({ onClose, onConfirm: vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' })) });
    await confirm();
    const error = container.querySelector('.confirm-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toBe(
      'Couldn’t reach the server. Check this device’s internet connection, then try again.',
    );
    expect(container.querySelector('.confirm-title')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(button('Do it').disabled).toBe(false);
  });

  it('says nothing when the session has ended (X2: routed globally)', async () => {
    await render({ onConfirm: vi.fn().mockRejectedValue(new ApiError({ kind: 'signed_out' })) });
    await confirm();
    expect(container.querySelector('.confirm-error')).toBeNull();
    expect(button('Do it').disabled).toBe(false);
  });

  it('never shows a stray error’s own message', async () => {
    await render({ onConfirm: vi.fn().mockRejectedValue(new TypeError('x is undefined')) });
    await confirm();
    expect(container.querySelector('.confirm-error')?.textContent).toBe(
      'Couldn’t make that change. Try again.',
    );
  });

  it('uses the caller’s describeError when given', async () => {
    const describeError = vi.fn().mockReturnValue('Couldn’t do it.');
    const failure = new ApiError({ kind: 'server', status: 500 });
    await render({ describeError, onConfirm: vi.fn().mockRejectedValue(failure) });
    await confirm();
    expect(describeError).toHaveBeenCalledWith(failure);
    expect(container.querySelector('.confirm-error')?.textContent).toBe('Couldn’t do it.');
  });

  it('clears the failure when the sheet is reopened', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' }));
    await render({ onConfirm });
    await confirm();
    expect(container.querySelector('.confirm-error')).not.toBeNull();
    await render({ onConfirm, open: false });
    await render({ onConfirm, open: true });
    expect(container.querySelector('.confirm-error')).toBeNull();
  });
});
