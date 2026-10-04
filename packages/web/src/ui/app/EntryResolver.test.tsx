import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  Navigate: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));

let auth = { status: 'anon', ready: true };
vi.mock('./AuthContext', () => ({
  useAuth: () => auth,
}));

import { EntryResolver } from './EntryResolver';
import { ServicesProvider } from '../common/ServicesContext';
import type { Services } from '../../services/Services';
import { ApiError } from '../../services/errors';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  auth = { status: 'anon', ready: true };
});

function fakeServices(get: ReturnType<typeof vi.fn>): Services {
  return { identity: { get, set: vi.fn(), clear: vi.fn() } } as unknown as Services;
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <EntryResolver />
      </ServicesProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const redirect = () => container.querySelector('[data-testid="redirect"]')?.textContent;
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('EntryResolver', () => {
  it('sends a signed-in staff device to the counter without asking for a card', async () => {
    auth = { status: 'active', ready: true };
    const get = vi.fn();
    await mount(fakeServices(get));
    expect(redirect()).toBe('/staff');
    expect(get).not.toHaveBeenCalled();
  });

  it('opens the card this device remembers', async () => {
    await mount(fakeServices(vi.fn().mockResolvedValue('tok-mine')));
    expect(redirect()).toBe('/card/tok-mine');
  });

  it('sends a device with no card to welcome — "no card" is an answer, not a failure', async () => {
    await mount(fakeServices(vi.fn().mockResolvedValue(null)));
    expect(redirect()).toBe('/welcome');
  });

  it('waits for auth boot before deciding', async () => {
    auth = { status: 'anon', ready: false };
    const get = vi.fn();
    await mount(fakeServices(get));
    expect(container.textContent).toContain('Loading…');
    expect(get).not.toHaveBeenCalled();
  });

  it('offline: never offers "Create your card"; says the card is safe and offers Try again', async () => {
    await mount(fakeServices(vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' }))));
    expect(redirect()).toBeUndefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t reach the café’s server. Your card is safe — try again when you’re back online.',
    );
    expect(button('Try again')).toBeDefined();
    // Connectivity has one remedy — wait and retry — so no way round it is offered.
    expect(button('Go to the welcome page')).toBeUndefined();
  });

  it('server error: says it was the server, not the connection', async () => {
    await mount(
      fakeServices(vi.fn().mockRejectedValue(new ApiError({ kind: 'server', status: 503 }))),
    );
    const text = container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(text).toContain('server had a problem');
    expect(text).toContain('Your card is safe');
    expect(text).not.toMatch(/online|connection/i);
  });

  it('Try again re-runs the check and goes on once it answers', async () => {
    let resolve!: (token: string) => void;
    const get = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ kind: 'offline' }))
      .mockImplementationOnce(() => new Promise<string>((r) => (resolve = r)));
    await mount(fakeServices(get));

    await click(button('Try again')!);
    expect(get).toHaveBeenCalledTimes(2);
    // The failure stays on screen, the button busy, until the answer lands.
    const busy = button('Trying…')!;
    expect(busy.disabled).toBe(true);

    await act(async () => {
      resolve('tok-back');
    });
    expect(redirect()).toBe('/card/tok-back');
  });

  it('a retry that fails again keeps the failure and re-enables Try again', async () => {
    const get = vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' }));
    await mount(fakeServices(get));
    await click(button('Try again')!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(button('Try again')?.disabled).toBe(false);
  });

  it('any other failure: its own sentence, Try again, and a way on to welcome', async () => {
    await mount(
      fakeServices(
        vi.fn().mockRejectedValue(new ApiError({ kind: 'forbidden', code: 'forbidden_origin' })),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'This page is out of date. Reload it, then try again.',
    );
    expect(button('Try again')).toBeDefined();
    await click(button('Go to the welcome page')!);
    expect(navigate).toHaveBeenCalledWith('/welcome');
  });

  it('a non-API error gets the plain fallback, never its own message', async () => {
    await mount(fakeServices(vi.fn().mockRejectedValue(new TypeError('boom'))));
    const text = container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(text).toBe('Something went wrong while checking for your card. Try again.');
  });
});
