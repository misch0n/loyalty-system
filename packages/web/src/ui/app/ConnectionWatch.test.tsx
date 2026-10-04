/**
 * The global failure handlers, driven through a real `ApiClient` whose `fetch`
 * is a test double — so what is pinned is the whole path from an HTTP answer to
 * what the person sees, not a hand-built event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiClient } from '../../adapters/http/ApiClient';
import { ServicesProvider } from '../common/ServicesContext';
import type { Services } from '../../services/Services';
import type { Actor } from '../../services/types';
import { ConnectionWatch } from './ConnectionWatch';
import { ROUTES } from './routes';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const auth = vi.hoisted(() => ({
  actor: null as Actor | null,
  logout: vi.fn(),
}));
vi.mock('./AuthContext', () => ({ useAuth: () => auth }));

const ADMIN: Actor = { id: 'a1', username: 'admin', role: 'admin' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ConnectionWatch', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: ApiClient;

  beforeEach(() => {
    auth.actor = null;
    auth.logout.mockReset();
    fetchMock = vi.fn();
    api = new ApiClient({ baseUrl: '/api', fetch: fetchMock, readCsrfToken: () => null });
  });

  /** Mounts with whatever `auth` holds now — set the actor first. */
  function mount(): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    const created = createRoot(container);
    root = created;
    act(() => {
      created.render(
        <MemoryRouter initialEntries={['/staff']}>
          <ServicesProvider value={{ connection: api } as unknown as Services}>
            <ConnectionWatch>
              <Routes>
                <Route path="/staff" element={<p>counter</p>} />
                <Route path={ROUTES.login} element={<p>sign in</p>} />
              </Routes>
            </ConnectionWatch>
          </ServicesProvider>
        </MemoryRouter>,
      );
    });
  }

  afterEach(() => {
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    root = undefined;
    container?.remove();
  });

  async function call(): Promise<void> {
    if (!root) mount();
    await act(async () => {
      await api.request('GET', '/config').catch(() => undefined);
    });
  }

  const banner = () => container.querySelector('.connection-banner');

  it('raises a persistent banner when the server cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await call();
    expect(banner()?.textContent).toMatch(/can’t reach the server/i);
    expect(banner()?.getAttribute('role')).toBe('status');
  });

  it('raises it for a 5xx too, and keeps it up across further failures', async () => {
    fetchMock.mockResolvedValueOnce(json(502, { error: 'internal_error' }));
    await call();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await call();
    expect(banner()).not.toBeNull();
  });

  it('lowers it on the next answer from the server — a refusal counts', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await call();
    fetchMock.mockResolvedValueOnce(json(404, { error: 'not_found' }));
    await call();
    expect(banner()).toBeNull();
  });

  it('signs a staff device out and sends it to sign-in when the session has ended', async () => {
    auth.actor = ADMIN;
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));
    await call();
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('sign in');
  });

  it('leaves a device with no staff signed in where it is', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));
    await call();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(container.textContent).toContain('counter');
  });

  it('does not treat a wrong password as a session that ended', async () => {
    auth.actor = ADMIN;
    fetchMock.mockResolvedValueOnce(json(401, { error: 'invalid_credentials' }));
    await call();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(container.textContent).toContain('counter');
  });

  it('shows nothing for an action failure — that belongs on the control', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: 'email_in_use' }));
    await call();
    expect(banner()).toBeNull();
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
