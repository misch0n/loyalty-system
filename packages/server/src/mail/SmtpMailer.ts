/**
 * `SmtpMailer` — the production side of the `Mailer` seam.
 *
 * BACKEND-PLAN §3-C-13 retires `EmailJsMailer` in the server build: its public
 * key ships in the client bundle, so anyone who opens devtools can send mail as
 * the café. Sending moves behind the API, where the credential is an environment
 * variable the browser never sees.
 *
 * **Why SMTP and not a provider's HTTP API.** One transport covers every case
 * the plan needs: mailpit in the dev Compose override (Phase 8), and SES, Brevo
 * or Resend in production — all three offer SMTP. A provider-specific HTTP
 * adapter would be a second adapter to write and a second one to keep working,
 * and `MAIL_SMTP_URL` swaps providers without a code change.
 *
 * **Why `nodemailer`.** `CLAUDE.md` rules out dependencies the spec didn't call
 * for; §3-C-13 called for a server-side mail provider, and SMTP with STARTTLS
 * and AUTH is exactly the kind of protocol where hand-rolling is the clever
 * option, not the boring one. `nodemailer` is the conventional Node answer and
 * pulls in no runtime dependencies of its own.
 *
 * **PII discipline.** A provider error routinely quotes the recipient address
 * ("550 no such user <someone@example.com>"). Every failure here is re-thrown as
 * a message carrying the *kind* and nothing else, so an error that reaches a log
 * or an error payload cannot carry the address with it.
 */

import { createTransport } from 'nodemailer';
import type { Mailer, OutboundMail } from '@cafe/shared/ports/Mailer';
import { renderMail } from './templates.js';

/** The slice of a nodemailer transporter this adapter uses. */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
  close?(): void;
}

export interface SmtpConfig {
  /** `smtp://user:pass@host:port` or `smtps://…`. Carries a password; never logged. */
  url: string;
  /** Envelope sender, e.g. `"Ckyka" <no-reply@example.test>`. */
  from: string;
}

export class SmtpMailer implements Mailer {
  /** Takes the transport explicitly so a test can drive it without a socket. */
  constructor(
    private readonly from: string,
    private readonly transport: MailTransport,
  ) {}

  static fromUrl(config: SmtpConfig): SmtpMailer {
    return new SmtpMailer(config.from, createTransport(config.url) as MailTransport);
  }

  async send(mail: OutboundMail): Promise<void> {
    const { subject, text } = renderMail(mail);
    try {
      await this.transport.sendMail({ from: this.from, to: mail.to, subject, text });
    } catch (err) {
      // Deliberately drops the provider's message. It is the one place an
      // address reliably appears in an error, and a send failure is diagnosed
      // from the SMTP server's own log, not from ours.
      const code = (err as { code?: string }).code;
      throw new Error(`SMTP send failed for a "${mail.kind}" mail${code ? ` (${code})` : ''}`);
    }
  }

  /** Releases the connection pool on shutdown. */
  close(): void {
    this.transport.close?.();
  }
}
