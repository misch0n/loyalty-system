/**
 * EmailJsMailer tests — pin the EmailJS REST request shape and confirm that PII
 * (the recipient address) never leaks into thrown errors on failure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmailJsMailer } from '../../src/adapters/email/EmailJsMailer';
import type { OutboundMail } from '../../src/ports/Mailer';

const config = {
  serviceId: 'service_abc',
  templateId: 'template_xyz',
  publicKey: 'pub_key_123',
};

const mail: OutboundMail = {
  to: 'secret.person@example.com',
  kind: 'recovery',
  params: { recovery_link: 'https://app.test/r/abc', display_name: 'Alex' },
};

describe('EmailJsMailer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the correct endpoint, method, and request body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await new EmailJsMailer(config).send(mail);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.emailjs.com/api/v1.0/email/send');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    expect(body.service_id).toBe('service_abc');
    expect(body.template_id).toBe('template_xyz');
    expect(body.user_id).toBe('pub_key_123');
    expect(body.template_params.to_email).toBe('secret.person@example.com');
    expect(body.template_params.mail_kind).toBe('recovery');
    // params are spread into template_params
    expect(body.template_params.recovery_link).toBe('https://app.test/r/abc');
    expect(body.template_params.display_name).toBe('Alex');
  });

  it('resolves on a 2xx response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new EmailJsMailer(config).send(mail)).resolves.toBeUndefined();
  });

  it('throws on a non-2xx response without leaking the recipient address', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('The Public Key is invalid', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await new EmailJsMailer(config).send(mail);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // Diagnostics present:
    expect(message).toContain('403');
    expect(message).toContain('The Public Key is invalid');
    // PII absent:
    expect(message).not.toContain('secret.person@example.com');
    expect(message).not.toContain('Alex');
  });
});
