/**
 * A throwaway SMTP sink, ~60 lines of `node:net`.
 *
 * BACKEND-PLAN's Phase 5 is "done when the recovery round-trip works against
 * mailpit". Mailpit arrives with the Compose bundle in Phase 8, so this stands
 * in for it here and proves the one thing a fake transport cannot: that
 * `SmtpMailer` genuinely speaks SMTP — that `nodemailer` is wired up correctly,
 * that the envelope carries our `MAIL_FROM` and the customer's address, and that
 * the rendered subject and body actually reach a server.
 *
 * It implements only what a client needs to complete one transaction. It is
 * **test scaffolding and nothing else** — no AUTH, no TLS, no validation, and
 * nothing in `src/` outside `testing/` may import it.
 */

import { createServer, type Server, type Socket } from 'node:net';

export interface ReceivedMail {
  from: string;
  to: string[];
  /** The DATA payload: headers, a blank line, then the body. */
  data: string;
}

export class SmtpSink {
  readonly received: ReceivedMail[] = [];
  private server: Server | null = null;

  /** Starts on an ephemeral port and returns the `smtp://` URL to point at it. */
  async listen(): Promise<string> {
    const server = createServer((socket) => this.serve(socket));
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('SMTP sink has no port');
    return `smtp://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private serve(socket: Socket): void {
    let envelope: ReceivedMail = { from: '', to: [], data: '' };
    let inData = false;
    let buffer = '';

    socket.setEncoding('utf8');
    socket.write('220 sink ESMTP\r\n');

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        envelope.data = buffer.slice(0, end);
        this.received.push(envelope);
        envelope = { from: '', to: [], data: '' };
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write('250 queued\r\n');
      }

      // Commands are line-oriented; anything without a terminator is a partial
      // read and waits for the rest.
      let newline = buffer.indexOf('\r\n');
      while (!inData && newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const verb = line.slice(0, 4).toUpperCase();

        if (verb === 'EHLO' || verb === 'HELO') socket.write('250 sink\r\n');
        else if (verb === 'MAIL') {
          envelope.from = addressIn(line);
          socket.write('250 ok\r\n');
        } else if (verb === 'RCPT') {
          envelope.to.push(addressIn(line));
          socket.write('250 ok\r\n');
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
          return;
        } else socket.write('250 ok\r\n');

        newline = buffer.indexOf('\r\n');
      }
    });

    socket.on('error', () => socket.destroy());
  }
}

/** Pulls the address out of `MAIL FROM:<a@b>` / `RCPT TO:<a@b>`. */
function addressIn(line: string): string {
  return /<([^>]*)>/.exec(line)?.[1] ?? '';
}
