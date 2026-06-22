/**
 * `Mailer` — the outbound-email seam.
 *
 * Mailer is a pluggable seam: the prototype uses a client-side EmailJS adapter,
 * and production swaps to a server-side provider (Resend / SendGrid / SES /
 * Brevo) with no call-site changes. The UI/services depend only on this
 * interface; the concrete adapter is chosen in the composition root.
 *
 * `params` may contain PII (name/email/phone) as template variables — never log
 * or embed them in errors.
 */

export type MailKind = 'recovery' | 'reward-available';

export interface OutboundMail {
  to: string; // recipient email address
  kind: MailKind;
  params: Record<string, string>; // template variables; assume may contain PII — never log
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}
