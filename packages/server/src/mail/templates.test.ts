import { describe, expect, it } from 'vitest';
import type { OutboundMail } from '@cafe/shared/ports/Mailer';
import { CAFE_NAME, MailTemplateError, renderMail } from './templates';

const CARD_LINK = 'https://cafe.example/#/card/abc';

describe('renderMail', () => {
  it('puts the recovery code in the body and nothing else in the subject', () => {
    const { subject, text } = renderMail({
      to: 'someone@example.test',
      kind: 'recovery',
      params: { code: 'K39XQ4', expiry_minutes: '15' },
    });

    expect(subject).toBe(`Your ${CAFE_NAME} recovery code`);
    expect(text).toContain('K39XQ4');
    expect(text).toContain('15 minutes');
  });

  it('carries no link in the recovery mail', () => {
    // SCOPE-DECISIONS §2.3 replaced the magic link *because* a link opens on
    // whichever device reads the mail. A link creeping back in would quietly
    // restore the behaviour the decision removed, so the absence is asserted.
    const { text } = renderMail({
      to: 'someone@example.test',
      kind: 'recovery',
      params: { code: 'K39XQ4', expiry_minutes: '15' },
    });
    expect(text).not.toMatch(/https?:\/\//);
  });

  it('never repeats the recipient address back into the mail', () => {
    // The body reaches a log only through an error, but it also reaches the
    // template functions, and "helpfully" greeting the customer by address is
    // the easiest way for PII to end up somewhere it is then quoted from.
    const to = 'someone@example.test';
    const mails: OutboundMail[] = [
      { to, kind: 'recovery', params: { code: 'K39XQ4', expiry_minutes: '15' } },
      { to, kind: 'card-created', params: { card_link: CARD_LINK } },
      { to, kind: 'reward-available', params: { reward: 'a free coffee', card_link: CARD_LINK } },
    ];
    for (const mail of mails) {
      const { subject, text } = renderMail(mail);
      expect(`${subject}\n${text}`).not.toContain(to);
    }
  });

  it('renders the reward-available mail from the configured reward description', () => {
    const { subject, text } = renderMail({
      to: 'someone@example.test',
      kind: 'reward-available',
      params: { reward: 'a free flat white', card_link: CARD_LINK },
    });

    expect(subject).toBe('Your a free flat white is ready');
    expect(text).toContain('a free flat white');
    expect(text).toContain(CARD_LINK);
  });

  it('renders the card-created mail with the card link', () => {
    const { subject, text } = renderMail({
      to: 'someone@example.test',
      kind: 'card-created',
      params: { card_link: CARD_LINK },
    });

    expect(subject).toBe(`Your ${CAFE_NAME} card is ready`);
    expect(text).toContain(CARD_LINK);
  });

  it('throws rather than sending a mail with a blank substitution', () => {
    // "Your recovery code is: undefined" is worse than a failed send, because
    // the customer cannot tell it went wrong and will wait for a second mail.
    expect(() =>
      renderMail({ to: 'someone@example.test', kind: 'recovery', params: { code: 'K39XQ4' } }),
    ).toThrow(MailTemplateError);
  });

  it('names the missing keys in the error and no values', () => {
    let error: MailTemplateError | null = null;
    try {
      renderMail({ to: 'someone@example.test', kind: 'recovery', params: {} });
    } catch (err) {
      error = err as MailTemplateError;
    }

    expect(error?.missing).toEqual(['code', 'expiry_minutes']);
    expect(error?.message).not.toContain('someone@example.test');
  });
});
