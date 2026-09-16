import { afterEach, describe, expect, it } from 'vitest';
import { SmtpMailer, type MailTransport } from './SmtpMailer.js';
import { SmtpSink } from '../testing/smtp.js';

const FROM = '"Ckyka" <no-reply@cafe.example>';
const TO = 'someone@example.test';

function recordingTransport(): MailTransport & { sent: Record<string, string>[] } {
  const sent: Record<string, string>[] = [];
  return {
    sent,
    async sendMail(message) {
      sent.push({ ...message });
    },
  };
}

describe('SmtpMailer', () => {
  it('sends the rendered subject and body from the configured sender', async () => {
    const transport = recordingTransport();
    await new SmtpMailer(FROM, transport).send({
      to: TO,
      kind: 'recovery',
      params: { code: 'K39XQ4', expiry_minutes: '15' },
    });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ from: FROM, to: TO });
    expect(transport.sent[0]?.subject).toContain('recovery code');
    expect(transport.sent[0]?.text).toContain('K39XQ4');
  });

  it('drops the provider’s message from a failure, address and all', async () => {
    // A rejection routinely quotes the recipient ("550 no such user <…>"), and
    // it travels straight to a log or an error payload. `CLAUDE.md` rules PII
    // out of both, so the provider's text is replaced rather than wrapped.
    const transport: MailTransport = {
      async sendMail() {
        throw Object.assign(new Error(`550 5.1.1 no such user <${TO}>`), { code: 'EENVELOPE' });
      },
    };

    await expect(
      new SmtpMailer(FROM, transport).send({ to: TO, kind: 'card-created', params: { card_link: 'x' } }),
    ).rejects.toThrow(/SMTP send failed for a "card-created" mail \(EENVELOPE\)/);

    await expect(
      new SmtpMailer(FROM, transport).send({ to: TO, kind: 'card-created', params: { card_link: 'x' } }),
    ).rejects.not.toThrow(new RegExp(TO));
  });

  it('refuses to send a mail whose template is missing a parameter', async () => {
    const transport = recordingTransport();
    await expect(
      new SmtpMailer(FROM, transport).send({ to: TO, kind: 'recovery', params: {} }),
    ).rejects.toThrow(/missing/);
    expect(transport.sent).toHaveLength(0);
  });
});

/**
 * The round trip Phase 5's "done when" asks for.
 *
 * `SmtpSink` stands in for the mailpit that arrives with the Compose bundle in
 * Phase 8, and proves what the injected transport above cannot: that the
 * adapter genuinely speaks SMTP, rather than being correctly wired to a double.
 */
describe('SmtpMailer over a real socket', () => {
  const sink = new SmtpSink();

  afterEach(async () => {
    await sink.close();
  });

  it('delivers a recovery mail end to end', async () => {
    const url = await sink.listen();
    const mailer = SmtpMailer.fromUrl({ url, from: FROM });

    await mailer.send({
      to: TO,
      kind: 'recovery',
      params: { code: 'K39XQ4', expiry_minutes: '15' },
    });
    mailer.close();

    expect(sink.received).toHaveLength(1);
    const mail = sink.received[0];
    expect(mail?.from).toBe('no-reply@cafe.example');
    expect(mail?.to).toEqual([TO]);
    expect(mail?.data).toContain('K39XQ4');
    expect(mail?.data).toMatch(/Subject: .*recovery code/i);
  });
});
