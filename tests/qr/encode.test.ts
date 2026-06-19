import { describe, it, expect } from 'vitest';
import { cardPayload, registrationPayload, toDataUrl } from '../../src/qr/encode';

describe('payloads', () => {
  it('card payload carries the bare token (no PII, no wrapping)', () => {
    expect(cardPayload('abc123')).toBe('abc123');
  });

  it('registration payload carries the transport join payload verbatim', () => {
    expect(registrationPayload('register/sess-1')).toBe('register/sess-1');
  });
});

describe('toDataUrl', () => {
  it('renders a payload to a PNG data URL', async () => {
    const url = await toDataUrl('hello');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan('data:image/png;base64,'.length);
  });
});
