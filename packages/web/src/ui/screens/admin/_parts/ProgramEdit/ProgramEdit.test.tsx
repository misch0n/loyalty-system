import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '../../../../../services/errors';
import { ProgramEdit } from './ProgramEdit';

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

/** Render the editor, save its pre-filled value against a rejecting `onConfirm`. */
async function saveFailingWith(failure: unknown): Promise<string | null | undefined> {
  const onConfirm = vi.fn().mockRejectedValue(failure);
  await act(async () => {
    root.render(
      <ProgramEdit
        open
        onClose={() => {}}
        title="Max coffees per scan"
        fieldLabel="Most coffees per scan?"
        current={3}
        min={1}
        max={20}
        onConfirm={onConfirm}
      />,
    );
  });
  const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save')!;
  await act(async () => {
    save.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(onConfirm).toHaveBeenCalledWith(3);
  // Still open, value kept.
  expect((container.querySelector('.progedit input') as HTMLInputElement).value).toBe('3');
  return container.querySelector('.progedit-error')?.textContent;
}

describe('ProgramEdit — save failure wording (UI-4)', () => {
  it.each([
    [
      'offline',
      new ApiError({ kind: 'offline' }),
      'Couldn’t reach the server. Check this device’s internet connection, then try again.',
    ],
    [
      'server',
      new ApiError({ kind: 'server', status: 500 }),
      'The server had a problem just now. Try again in a moment.',
    ],
    [
      'csrf',
      new ApiError({ kind: 'forbidden', code: 'csrf_failed' }),
      'This page is out of date. Reload it, then try again.',
    ],
    [
      'role',
      new ApiError({ kind: 'forbidden', code: 'forbidden' }),
      'This needs an admin account. Sign in as an admin, then try again.',
    ],
    [
      'rate_limited',
      new ApiError({ kind: 'rate_limited', retryAfterSec: null }),
      'Too many changes in a row. Wait a moment, then try again.',
    ],
    [
      'rejected_field',
      new ApiError({ kind: 'rejected', code: 'rejected_field' }),
      'That setting can’t be changed here.',
    ],
    [
      'rejected value',
      new ApiError({ kind: 'rejected', code: 'invalid_request' }),
      'The server didn’t accept that value. Enter a whole number from 1 to 20.',
    ],
    ['not the API’s', new TypeError('boom'), 'Couldn’t save that change. Try again.'],
  ])('%s', async (_kind, failure, copy) => {
    expect(await saveFailingWith(failure)).toBe(copy);
  });

  it('says nothing when the session has ended — sign-in is routed globally (X2)', async () => {
    expect(await saveFailingWith(new ApiError({ kind: 'signed_out' }))).toBeUndefined();
  });
});
