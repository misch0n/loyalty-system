import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('server', () => {
  it('reports liveness on /healthz without touching the database', async () => {
    // No `isDbReachable` at all: liveness must not depend on one.
    const app = buildServer({ logLevel: 'silent' });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('answers /healthz even while the database is down', async () => {
    const app = buildServer({ logLevel: 'silent', isDbReachable: async () => false });

    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  });

  it('reports readiness on /readyz when the database is reachable', async () => {
    const app = buildServer({ logLevel: 'silent', isDbReachable: async () => true });
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
    await app.close();
  });

  it('answers /readyz with 503 when the database is unreachable', async () => {
    const app = buildServer({ logLevel: 'silent', isDbReachable: async () => false });
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', database: 'unreachable' });
    await app.close();
  });

  it('404s an unknown route without echoing the request back', async () => {
    const app = buildServer({ logLevel: 'silent' });
    const response = await app.inject({ method: 'GET', url: '/nope?email=ada@example.com' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
    expect(response.body).not.toContain('ada@example.com');
    await app.close();
  });

  it('keeps PII out of the access log, including on a 404', async () => {
    // Regression: Fastify's DEFAULT 404 handler logs the raw URL as a plain
    // message, which walks straight past the request serializer. Found by
    // curling a live server during Phase 0.
    const lines: string[] = [];
    const app = buildServer({
      logLevel: 'info',
      loggerDestination: { write: (line: string) => lines.push(line) },
    });

    await app.inject({ method: 'GET', url: '/customers?term=ada@example.com' });
    await app.close();

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain('ada@example.com');
  });
});
