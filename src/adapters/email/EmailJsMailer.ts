/**
 * EmailJsMailer — PROTOTYPE-ONLY stand-in for the `Mailer` seam.
 *
 * Sends mail straight from the browser via EmailJS's REST API (no backend, no
 * new npm dependency — plain `fetch`). The EmailJS public key is exposed in the
 * client bundle BY DESIGN; EmailJS rate-limits per key, which is acceptable for
 * a demo. Production moves sending server-side (Resend/SendGrid/SES/Brevo) behind
 * the same `Mailer` interface, so call sites don't change.
 *
 * PII safety: `mail.to` and `mail.params` may contain personal data. They are
 * sent to EmailJS but are NEVER logged and NEVER included in thrown errors.
 */

import type { Mailer, OutboundMail } from '../../ports/Mailer';

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

export interface EmailJsConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
}

export class EmailJsMailer implements Mailer {
  constructor(private readonly config: EmailJsConfig) {}

  async send(mail: OutboundMail): Promise<void> {
    const body = {
      service_id: this.config.serviceId,
      template_id: this.config.templateId,
      user_id: this.config.publicKey,
      template_params: {
        to_email: mail.to,
        mail_kind: mail.kind,
        ...mail.params,
      },
    };

    const response = await fetch(EMAILJS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Read the provider's response text for diagnostics. Deliberately omit the
      // recipient address and any template params — those may be PII.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `EmailJS send failed (HTTP ${response.status}): ${detail}`,
      );
    }
  }
}
