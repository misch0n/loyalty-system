/**
 * The mail composition root.
 *
 * `CLAUDE.md`: *"Composition root is the only place that names a concrete
 * adapter."* This is that place for the `Mailer` seam on the server side —
 * `index.ts` asks for a mailer and gets one, without knowing whether it speaks
 * SMTP.
 */

import type { Mailer } from '@cafe/shared/ports/Mailer';
import type { Env } from '../env.js';
import { LogMailer, type MailLog } from './LogMailer.js';
import { SmtpMailer } from './SmtpMailer.js';

export { LogMailer } from './LogMailer.js';
export type { MailLog } from './LogMailer.js';
export { SmtpMailer } from './SmtpMailer.js';
export { CAFE_NAME, MailTemplateError, renderMail } from './templates.js';
export type { RenderedMail } from './templates.js';

/**
 * Picks the adapter from the environment. `log` is the sink `LogMailer` writes
 * to when there is nothing to send with — it is called at *send* time, never
 * here, so a caller may pass a closure over a logger that does not exist yet.
 */
export function createMailer(env: Env, log: MailLog): Mailer {
  if (!env.mail) return new LogMailer(log);
  return SmtpMailer.fromUrl({ url: env.mail.smtpUrl, from: env.mail.from });
}

/**
 * What to say about mail at boot.
 *
 * An unconfigured mailer is legitimate locally and a serious problem in
 * production — nobody can recover a card without it — so it announces itself
 * once at startup rather than being discovered from a support request. Returned
 * rather than logged so the caller can emit it on the server's own logger, which
 * does not exist until after the mailer has been built.
 */
export function mailStartupNotice(env: Env): {
  level: 'info' | 'warn';
  message: string;
} {
  return env.mail
    ? { level: 'info', message: 'outbound mail enabled' }
    : {
        level: 'warn',
        message: 'MAIL_SMTP_URL is not set — recovery codes and receipts are logged, not sent',
      };
}
