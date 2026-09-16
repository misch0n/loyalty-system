/**
 * `LogMailer` — the unconfigured fallback, mirroring the prototype's
 * `NoopMailer`.
 *
 * A server with no `MAIL_SMTP_URL` still has to run: local development against a
 * database, the test suite, a Compose stack brought up before mailpit. What it
 * must not do is fail a registration or a commit because a transactional mail
 * had nowhere to go.
 *
 * It differs from `NoopMailer` in one way that matters operationally: it leaves
 * a `warn` line, so "the recovery mail never arrived" is diagnosable from the
 * log instead of being perfect silence. The line carries the **kind only** —
 * never the recipient, which is PII (`CLAUDE.md`).
 */

import type { Mailer, OutboundMail } from '@cafe/shared/ports/Mailer';

export type MailLog = (details: { kind: string }, message: string) => void;

export class LogMailer implements Mailer {
  constructor(private readonly log: MailLog) {}

  async send(mail: OutboundMail): Promise<void> {
    this.log({ kind: mail.kind }, 'mail not sent — no SMTP is configured');
  }
}
