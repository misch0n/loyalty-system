import { describe, expect, it } from 'vitest';
import {
  CENSOR,
  loggerOptions,
  safeUrl,
  scrubText,
  SENSITIVE_KEYS,
  serializeError,
  serializeRequest,
} from './logging.js';

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

  it('scrubs an error message and its stack', () => {
    const error = Object.assign(new Error('no card for ada@example.com'), { code: '23505' });
    const logged = serializeError(error);

    expect(logged.message).toBe('no card for [redacted-email]');
    expect(logged.code).toBe('23505');
    expect(String(logged.stack)).not.toContain('ada@example.com');
  });
});
