import { describe, expect, it } from 'vitest';
import { LogMailer } from './LogMailer.js';

describe('LogMailer', () => {
  it('records the kind and never the recipient', async () => {
    // The whole reason this adapter logs at all is that "the recovery mail never
    // arrived" should be diagnosable. That value evaporates if the line cannot
    // be kept, so it carries the kind and nothing that is PII.
    const lines: { details: { kind: string }; message: string }[] = [];
    const mailer = new LogMailer((details, message) => lines.push({ details, message }));

    await mailer.send({
      to: 'someone@example.test',
      kind: 'recovery',
      params: { code: 'K39XQ4', expiry_minutes: '15' },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.details).toEqual({ kind: 'recovery' });
    expect(JSON.stringify(lines[0])).not.toContain('someone@example.test');
    expect(JSON.stringify(lines[0])).not.toContain('K39XQ4');
  });

  it('resolves rather than throwing, so an unconfigured mailer breaks nothing', async () => {
    await expect(
      new LogMailer(() => {}).send({ to: 'a@b.test', kind: 'card-created', params: {} }),
    ).resolves.toBeUndefined();
  });
});
