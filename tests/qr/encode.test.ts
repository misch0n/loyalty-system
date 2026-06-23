import { describe, it, expect } from 'vitest';
import {
  cardPayload,
  tokenFromCardScan,
  registrationPayload,
  toDataUrl,
} from '../../src/qr/encode';

describe('payloads', () => {
  it('card payload encodes the card-page URL carrying the token (no PII)', () => {
    const url = cardPayload('abc123');
    expect(url).toContain('#/status/abc123');
    expect(url.startsWith('http')).toBe(true);
  });

  it('tokenFromCardScan extracts the token from a scanned card URL or a bare token', () => {
    expect(tokenFromCardScan(cardPayload('abc123'))).toBe('abc123');
    expect(tokenFromCardScan('  abc123  ')).toBe('abc123');
  });

  it('registration payload wraps the peer id into the full register URL', () => {
    const url = registrationPayload('peer:sess-1');
    // Absolute URL into the HashRouter register route, peer prefix stripped.
    expect(url).toContain('#/register/sess-1');
    expect(url.startsWith('http')).toBe(true);
    expect(url).not.toContain('peer:');
  });
});

describe('toDataUrl', () => {
  it('renders a payload to a PNG data URL', async () => {
    const url = await toDataUrl('hello');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan('data:image/png;base64,'.length);
  });
});
