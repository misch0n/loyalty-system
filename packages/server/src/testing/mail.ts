/**
 * A `Mailer` the tests can read.
 *
 * Route tests need to assert two opposite things about outbound mail: that a
 * known address gets exactly one, and that an unknown one gets none. Both are
 * assertions about an outbox, so the double is one.
 *
 * It also renders each mail through the real templates. A test that only
 * captured `OutboundMail` would pass with a template that throws on a missing
 * parameter, which is precisely the bug {@link MailTemplateError} exists to
 * catch — so the double runs the same render the SMTP adapter would.
 */

import type { Mailer, OutboundMail } from '@cafe/shared/ports/Mailer';
import { renderMail } from '../mail/templates';

export interface SentMail extends OutboundMail {
  subject: string;
  text: string;
}

export class CollectingMailer implements Mailer {
  readonly outbox: SentMail[] = [];
  /** When set, every send rejects with it — for the delivery-failure paths. */
  failWith: Error | null = null;
  private gate: Promise<void> | null = null;

  /**
   * Blocks every send until the returned release is called — a stand-in for a
   * slow mail server.
   *
   * Without it, "the route answered before the mail was sent" is untestable:
   * this double completes in the same microtask, so the send would be finished
   * by the time the test looked, whether or not the route awaited it.
   */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = () => {
        this.gate = null;
        resolve();
      };
    });
    return release;
  }

  async send(mail: OutboundMail): Promise<void> {
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    const { subject, text } = renderMail(mail);
    this.outbox.push({ ...mail, subject, text });
  }

  /** The most recent mail of a kind, or `undefined`. */
  last(kind?: OutboundMail['kind']): SentMail | undefined {
    const matching = kind ? this.outbox.filter((mail) => mail.kind === kind) : this.outbox;
    return matching[matching.length - 1];
  }

  clear(): void {
    this.outbox.length = 0;
    this.failWith = null;
    this.gate = null;
  }
}
