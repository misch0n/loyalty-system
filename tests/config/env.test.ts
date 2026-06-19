/**
 * env.ts is the single place that reads import.meta.env. Its job is to translate
 * env vars into plain feature flags. We re-import the module under different
 * stubbed envs (resetting the module cache each time) to verify that mapping —
 * crucially, that the DEV-ONLY peer transport is never selected in a prod build.
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
  it('uses the in-browser bridge transport and IndexedDB store', async () => {
    const env = await loadEnv();
    expect(env.transportKind).toBe('bridge');
    expect(env.storeKind).toBe('indexeddb');
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
  it('selects the dev peer transport when VITE_DEV_TRANSPORT=peer outside production', async () => {
    vi.stubEnv('VITE_DEV_TRANSPORT', 'peer');
    vi.stubEnv('PROD', false);
    const env = await loadEnv();
    expect(env.isProduction).toBe(false);
    expect(env.transportKind).toBe('peer');
  });

  it('NEVER selects the peer transport in a production build', async () => {
    vi.stubEnv('VITE_DEV_TRANSPORT', 'peer');
    vi.stubEnv('PROD', true);
    const env = await loadEnv();
    expect(env.isProduction).toBe(true);
    expect(env.transportKind).toBe('bridge');
  });
});
