/**
 * NoopMailer tests — it resolves without sending and must not throw, so the app
 * degrades gracefully when EmailJS isn't configured.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NoopMailer } from '../../src/adapters/email/NoopMailer';
import type { OutboundMail } from '../../src/ports/Mailer';

const mail: OutboundMail = {
  to: 'secret.person@example.com',
  kind: 'reward-available',
  params: { display_name: 'Alex' },
};

describe('NoopMailer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves without throwing', async () => {
    await expect(new NoopMailer().send(mail)).resolves.toBeUndefined();
  });

  it('does not log the recipient or params (PII)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await new NoopMailer().send(mail);

    const logged = info.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(logged).not.toContain('secret.person@example.com');
    expect(logged).not.toContain('Alex');
  });
});
