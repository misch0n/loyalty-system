/**
 * NoopMailer — the graceful-degradation `Mailer`.
 *
 * Used when EmailJS isn't configured (e.g. local dev without secrets) so the app
 * degrades gracefully instead of crashing when something tries to send mail.
 * `send()` resolves without sending anything.
 *
 * PII safety: it may log the `mail.kind` ONLY — never `to` or `params`, which
 * may contain personal data.
 */

import type { Mailer, OutboundMail } from '../../ports/Mailer';

export class NoopMailer implements Mailer {
  async send(mail: OutboundMail): Promise<void> {
    // eslint-disable-next-line no-console
    console.info(`[NoopMailer] dropped mail of kind: ${mail.kind}`);
  }
}
