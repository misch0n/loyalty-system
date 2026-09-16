import { describe, expect, it } from 'vitest';
import {
  CALL_SITE_SENSITIVE_KEYS,
  CENSOR,
  loggerOptions,
  safeUrl,
  scrubText,
  SENSITIVE_KEYS,
  serializeError,
  serializeRequest,
} from './logging.js';
import { buildServer } from './server.js';

/**
 * Emits one line through a real, fully-configured logger and returns it parsed.
 *
 * The redaction under test is pino's, not ours: `redactPaths()` produces path
 * strings that only pino knows how to apply, so asserting on the path list
 * proves the intent while this proves the effect. Goes through `buildServer` for
 * the same reason `server.test.ts` does — that is the assembly that actually
 * ships.
 */
async function logged(details: Record<string, unknown>): Promise<Record<string, unknown>> {
  const lines: string[] = [];
  const app = buildServer({
    logLevel: 'info',
    loggerDestination: { write: (line: string) => lines.push(line) },
  });
  app.log.info(details, 'under test');
  await app.close();

  const line = lines.find((entry) => entry.includes('under test'));
  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

describe('log redaction', () => {
  it('scrubs an email address out of free text', () => {
    expect(scrubText('duplicate key value: (email)=(ada@example.com) already exists')).toBe(
      'duplicate key value: (email)=([redacted-email]) already exists',
    );
  });

  it('leaves text with no PII alone', () => {
    expect(scrubText('customer_not_found')).toBe('customer_not_found');
  });

  it('strips the query string from a logged URL', () => {
    // BACKEND-PLAN §3-B-11: no PII in URLs — and none in the log of one either.
    expect(safeUrl('/customers?term=ada@example.com')).toBe('/customers?[redacted]');
    expect(safeUrl('/healthz')).toBe('/healthz');
    expect(safeUrl(undefined)).toBe('');
  });

  it('redacts a credential carried in a path segment, not just a query value', () => {
    // Phase 4 moved customer search into a POST body, but two routes name a
    // *credential* in the path by design: a card's 128-bit token and the short
    // code staff type when the camera fails. Neither is PII; both are what
    // grants access to a card, and Phase 3's rule that a credential never
    // reaches a log holds whatever shape it arrives in.
    expect(safeUrl('/customers/by-token/9rT3xQm2AbCdEfGhIjKlMn')).toBe(
      `/customers/by-token/${CENSOR}`,
    );
    expect(safeUrl('/customers/by-code/K39XQ4T7')).toBe(`/customers/by-code/${CENSOR}`);
    // An id is not a credential, so a path that names one is logged whole.
    expect(safeUrl('/customers/abc-123/state')).toBe('/customers/abc-123/state');
  });

  it('redacts every sensitive key, at the top level and one level down', () => {
    const { redact } = loggerOptions('info');

    for (const key of SENSITIVE_KEYS) {
      expect(redact.paths).toContain(key);
      expect(redact.paths).toContain(`*.${key}`);
    }
    expect(redact.censor).toBe(CENSOR);
  });

  it('reduces a request to method and path — headers and bodies never reach the log', () => {
    const logged = serializeRequest({
      id: 'req-1',
      method: 'POST',
      url: '/customers?email=ada@example.com',
      // Extra fields a real Fastify request carries; none may survive.
      ...{ headers: { cookie: 'session=secret' }, body: { email: 'ada@example.com' } },
    });

    expect(logged).toEqual({ id: 'req-1', method: 'POST', url: '/customers?[redacted]' });
    expect(loggerOptions('info').serializers.req).toBe(serializeRequest);
  });

  it("keeps a database error's SQLSTATE, which is what a 500 is diagnosed from", async () => {
    // Carried from Phase 4 and sharpened by Phase 5: `code` was redacted at
    // every depth, which hid recovery codes (right) and every `err.code` with
    // them (wrong). Phase 5 worked around it by writing the provider's code into
    // the error *message*; this is the fix that workaround was waiting for.
    const line = await logged({ err: Object.assign(new Error('duplicate key'), { code: '23505' }) });

    expect((line.err as { code: string }).code).toBe('23505');
  });

  it('still redacts a `code` a call site logs itself', async () => {
    // The other half. A recovery code is six typed characters (SCOPE-DECISIONS
    // §2.3) and would be a credential in a log line, so the prefixes a call site
    // uses stay covered — only the one-level wildcard that `err.code` matches
    // was given up.
    const line = await logged({ code: 'K39XQ4', details: { code: 'K39XQ4' } });

    expect(line.code).toBe(CENSOR);
    expect((line.details as { code: string }).code).toBe(CENSOR);
  });

  it('redacts an explicitly-named recovery code at any depth', async () => {
    // The belt to that braces: `recoveryCode` is in SENSITIVE_KEYS, so it keeps
    // the one-level wildcard a bare `code` gave up. If a recovery code ever does
    // belong in a line, this is the key to log it under.
    const line = await logged({ mail: { recoveryCode: 'K39XQ4' }, recovery_code: 'K39XQ4' });

    expect((line.mail as { recoveryCode: string }).recoveryCode).toBe(CENSOR);
    expect(line.recovery_code).toBe(CENSOR);
  });

  it('exempts `code` from the wildcard and from nothing else', () => {
    const { redact } = loggerOptions('info');

    expect(CALL_SITE_SENSITIVE_KEYS).toEqual(['code']);
    expect(redact.paths).toContain('code');
    expect(redact.paths).toContain('details.code');
    expect(redact.paths).toContain('req.body.code');
    // The one path deliberately absent — `err.code` is what matches it.
    expect(redact.paths).not.toContain('*.code');
  });

  it('scrubs an error message and its stack', () => {
    const error = Object.assign(new Error('no card for ada@example.com'), { code: '23505' });
    const logged = serializeError(error);

    expect(logged.message).toBe('no card for [redacted-email]');
    expect(logged.code).toBe('23505');
    expect(String(logged.stack)).not.toContain('ada@example.com');
  });
});
