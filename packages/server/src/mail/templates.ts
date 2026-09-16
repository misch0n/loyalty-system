/**
 * Mail bodies, rendered server-side.
 *
 * The `Mailer` port carries a `kind` and a bag of template `params`; the
 * prototype's `EmailJsMailer` hands both to EmailJS, where the *provider* holds
 * the template. A server build has no provider-side template, so the wording
 * lives here — which is the better place for it anyway: the three mails are
 * transactional, they are part of the product, and they belong in the repository
 * next to the routes that send them rather than in a third-party dashboard.
 *
 * **PII discipline.** `mail.to` and several params are personal data
 * (`CLAUDE.md`: never log PII). Nothing in this file logs, and
 * {@link MailTemplateError} names the *keys* that were missing, never their
 * values — so a template bug surfaces without the address surfacing with it.
 */

import type { OutboundMail } from '@cafe/shared/ports/Mailer';

/**
 * The café's name as it appears in a subject line.
 *
 * A copy of `cafeName` in `src/config/cafe.ts`, deliberately: that file lives in
 * the SPA tree, which **Phase 10 moves to `packages/web`** — importing it here
 * would be an import Phase 10 then has to unpick. Phase 10 should lift the
 * constant into `packages/shared` and delete this copy. Until then the drift
 * risk is a brand string in a subject line, which is visible the first time
 * anyone reads a test mail.
 */
export const CAFE_NAME = 'Ckyka';

export interface RenderedMail {
  subject: string;
  text: string;
}

/** A template asked for a parameter the caller did not supply. */
export class MailTemplateError extends Error {
  constructor(
    readonly kind: string,
    readonly missing: string[],
  ) {
    // Keys only — a value here would be the customer's address or their card link.
    super(`Mail template "${kind}" is missing: ${missing.join(', ')}`);
    this.name = 'MailTemplateError';
  }
}

/**
 * Reads the params a template needs, or throws naming every one that is absent.
 *
 * Deliberately strict rather than substituting a blank: a mail that reads "your
 * code is undefined" is worse than a send that fails loudly, because the
 * customer cannot tell it went wrong and will wait for a second one.
 */
function require_(mail: OutboundMail, keys: string[]): Record<string, string> {
  const missing = keys.filter((key) => !mail.params[key]);
  if (missing.length > 0) throw new MailTemplateError(mail.kind, missing);
  return Object.fromEntries(keys.map((key) => [key, mail.params[key] as string]));
}

/**
 * The recovery mail (SCOPE-DECISIONS §2.3).
 *
 * **It carries no link, and that is the point.** The emailed magic link was
 * replaced precisely because a link opens on whichever device happens to read
 * the mail — frequently the wrong one. The code is typed on the device already
 * in the customer's hand, and that device is what gets bound to the card.
 */
function recovery(mail: OutboundMail): RenderedMail {
  const { code, expiry_minutes } = require_(mail, ['code', 'expiry_minutes']);
  return {
    subject: `Your ${CAFE_NAME} recovery code`,
    text: [
      `Your recovery code is: ${code}`,
      '',
      `Type it on the device you are holding to restore your loyalty card there.`,
      `The code can be used once and expires in ${expiry_minutes} minutes.`,
      '',
      "If you didn't ask to restore a card, you can ignore this email — nothing has changed.",
    ].join('\n'),
  };
}

function rewardAvailable(mail: OutboundMail): RenderedMail {
  const { reward, card_link } = require_(mail, ['reward', 'card_link']);
  return {
    subject: `Your ${reward} is ready`,
    text: [
      `You've earned a reward: ${reward}.`,
      '',
      'Show your card on your next visit to redeem it.',
      '',
      `View your card: ${card_link}`,
    ].join('\n'),
  };
}

function cardCreated(mail: OutboundMail): RenderedMail {
  const { card_link } = require_(mail, ['card_link']);
  return {
    subject: `Your ${CAFE_NAME} card is ready`,
    text: [
      `Your ${CAFE_NAME} loyalty card has been created.`,
      '',
      'Show it on your next visit to start collecting.',
      '',
      `View your card: ${card_link}`,
    ].join('\n'),
  };
}

const TEMPLATES = {
  recovery,
  'reward-available': rewardAvailable,
  'card-created': cardCreated,
} as const;

/** Renders an outbound mail. Throws {@link MailTemplateError} on a missing param. */
export function renderMail(mail: OutboundMail): RenderedMail {
  const template = TEMPLATES[mail.kind];
  if (!template) throw new MailTemplateError(mail.kind, ['<unknown kind>']);
  return template(mail);
}
