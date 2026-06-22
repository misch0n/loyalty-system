import type { Mailer, OutboundMail } from '../../src/ports/Mailer';

/** A Mailer that records every send so tests can assert on outbound email. */
export class SpyMailer implements Mailer {
  sent: OutboundMail[] = [];
  async send(mail: OutboundMail): Promise<void> {
    this.sent.push(mail);
  }
}
