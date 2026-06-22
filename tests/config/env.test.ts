/**
 * env.ts is the single place that reads import.meta.env. Its job is to translate
 * env vars into plain feature flags + external-service config. We re-import the
 * module under different stubbed envs (resetting the module cache each time) to
 * verify that mapping — crucially, that the prototype peer transport is never
 * selected in a production build, and that secrets are absent unless injected.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadEnv() {
  vi.resetModules();
  return import('../../src/config/env');
}

describe('defaults', () => {
  it('uses the real peer transport and IndexedDB store outside production', async () => {
    const env = await loadEnv();
    expect(env.isProduction).toBe(false);
    expect(env.transportKind).toBe('peer');
    expect(env.storeKind).toBe('indexeddb');
  });

  it('has no email/TURN secrets unless injected', async () => {
    const env = await loadEnv();
    expect(env.isEmailConfigured).toBe(false);
    expect(env.turnConfigured).toBe(false);
    // STUN-only ICE config (two public STUN entries, no TURN relay).
    expect(env.iceServers.every((s) => String(s.urls).startsWith('stun:'))).toBe(true);
  });
});

describe('storeKind', () => {
  it('selects the api store when VITE_DATASTORE=api', async () => {
    vi.stubEnv('VITE_DATASTORE', 'api');
    expect((await loadEnv()).storeKind).toBe('api');
  });

  it('falls back to indexeddb for any other value', async () => {
    vi.stubEnv('VITE_DATASTORE', 'something-else');
    expect((await loadEnv()).storeKind).toBe('indexeddb');
  });
});

describe('transportKind', () => {
  it('defaults to the real peer transport (the prototype)', async () => {
    expect((await loadEnv()).transportKind).toBe('peer');
  });

  it('switches to the server transport only when VITE_TRANSPORT=server', async () => {
    vi.stubEnv('VITE_TRANSPORT', 'server');
    expect((await loadEnv()).transportKind).toBe('server');
  });

  it('stays on peer in a production build (deployed prototype still needs PeerJS)', async () => {
    // The GitHub Pages deploy is a production `vite build` yet IS the prototype.
    vi.stubEnv('PROD', true);
    const env = await loadEnv();
    expect(env.isProduction).toBe(true);
    expect(env.transportKind).toBe('peer');
  });
});

describe('emailConfig', () => {
  it('is configured only when all three EmailJS values are present', async () => {
    vi.stubEnv('VITE_EMAILJS_SERVICE_ID', 'svc');
    vi.stubEnv('VITE_EMAILJS_TEMPLATE_ID', 'tpl');
    vi.stubEnv('VITE_EMAILJS_PUBLIC_KEY', 'key');
    const env = await loadEnv();
    expect(env.isEmailConfigured).toBe(true);
    expect(env.emailConfig).toEqual({ serviceId: 'svc', templateId: 'tpl', publicKey: 'key' });
  });

  it('is not configured when a value is missing', async () => {
    vi.stubEnv('VITE_EMAILJS_SERVICE_ID', 'svc');
    vi.stubEnv('VITE_EMAILJS_TEMPLATE_ID', 'tpl');
    // public key missing
    expect((await loadEnv()).isEmailConfigured).toBe(false);
  });
});

describe('iceServers', () => {
  it('adds TURN relay entries when credentials are injected', async () => {
    vi.stubEnv('VITE_TURN_USERNAME', 'user');
    vi.stubEnv('VITE_TURN_CREDENTIAL', 'secret');
    const env = await loadEnv();
    expect(env.turnConfigured).toBe(true);
    const turn = env.iceServers.filter((s) => String(s.urls).startsWith('turn'));
    expect(turn.length).toBeGreaterThan(0);
    expect(turn.every((s) => s.username === 'user' && s.credential === 'secret')).toBe(true);
  });
});
