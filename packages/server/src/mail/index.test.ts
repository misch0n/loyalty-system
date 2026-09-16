import { describe, expect, it } from 'vitest';
import { parseEnv } from '../env';
import { createMailer, mailStartupNotice, LogMailer, SmtpMailer } from './index';

const BASE = { DATABASE_URL: 'postgres://cafe:cafe@localhost:5432/cafe' };

describe('createMailer', () => {
  it('falls back to LogMailer when no SMTP is configured', () => {
    expect(createMailer(parseEnv(BASE), () => {})).toBeInstanceOf(LogMailer);
  });

  it('builds an SmtpMailer when it is', () => {
    const env = parseEnv({
      ...BASE,
      MAIL_SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'no-reply@cafe.example',
      APP_URL: 'https://cafe.example',
    });
    expect(createMailer(env, () => {})).toBeInstanceOf(SmtpMailer);
  });

  it('never calls the log sink at construction time', () => {
    // `index.ts` passes a closure over a logger that does not exist yet — the
    // server cannot be built before its dependencies. Calling the sink here
    // would be a boot-time crash rather than a missing log line.
    let called = 0;
    createMailer(parseEnv(BASE), () => {
      called += 1;
    });
    expect(called).toBe(0);
  });
});

describe('mailStartupNotice', () => {
  it('warns when mail is unconfigured', () => {
    // Legitimate locally, serious in production: nobody can recover a card. It
    // says so once at boot rather than being discovered from a support request.
    expect(mailStartupNotice(parseEnv(BASE))).toMatchObject({ level: 'warn' });
  });

  it('confirms at info when it is configured', () => {
    const env = parseEnv({
      ...BASE,
      MAIL_SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'no-reply@cafe.example',
      APP_URL: 'https://cafe.example',
    });
    expect(mailStartupNotice(env)).toMatchObject({ level: 'info' });
  });

  it('keeps the SMTP URL out of the notice — it carries a password', () => {
    const env = parseEnv({
      ...BASE,
      MAIL_SMTP_URL: 'smtp://user:hunter2@mail.example:587',
      MAIL_FROM: 'no-reply@cafe.example',
      APP_URL: 'https://cafe.example',
    });
    expect(mailStartupNotice(env).message).not.toContain('hunter2');
  });
});
