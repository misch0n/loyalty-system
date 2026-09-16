/**
 * `env.ts` is the single place that reads `import.meta.env`.
 *
 * It used to be mostly adapter selection, and this file used to be mostly proof
 * that the selection was right — that a production build never picked the peer
 * transport, that secrets were absent unless injected. Phase 6 removed every one
 * of those flags: there is one store, one mail sender (the server) and no peer
 * connection, so there is nothing left to select. What remains is build config,
 * and the tests shrank with it.
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
  it('is not a production build under vitest', async () => {
    expect((await loadEnv()).isProduction).toBe(false);
  });

  it('reaches the API on the same origin', async () => {
    // The Compose bundle serves the SPA and reverse-proxies `/api` from one
    // nginx, so the default needs no configuration at all (Phase 8).
    expect((await loadEnv()).apiBaseUrl).toBe('/api');
  });

  it('carries the café’s Place ID for the review link', async () => {
    expect((await loadEnv()).googlePlaceId).toMatch(/^ChIJ/);
  });
});

describe('build-time overrides', () => {
  it('points the API elsewhere when VITE_API_BASE is set', async () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.test');
    expect((await loadEnv()).apiBaseUrl).toBe('https://api.example.test');
  });

  it('overrides the Place ID', async () => {
    vi.stubEnv('VITE_GOOGLE_PLACE_ID', 'ChIJ-other');
    expect((await loadEnv()).googlePlaceId).toBe('ChIJ-other');
  });

  it('falls back to the default Place ID when the override is blank', async () => {
    vi.stubEnv('VITE_GOOGLE_PLACE_ID', '');
    expect((await loadEnv()).googlePlaceId).toMatch(/^ChIJ/);
  });
});
