/**
 * The live project's global setup — **the real server, against a real Postgres**.
 *
 * Register P6 (settled 2026-10-03): there is no fake `DataStore` anywhere. The
 * service and `ApiStore` suites drive the server the SPA will actually talk to,
 * over HTTP, and **fail rather than skip** when there is no database — a skipped
 * suite reports green and proves nothing, which is the lesson the server suite
 * already learned (`packages/server/src/testing/globalSetup.ts`).
 *
 * The SPA and the server share `@cafe/shared` and nothing else, so this file
 * reaches the server only the way an operator does: its built `dist/` entry
 * points and its environment variables. Once per run it
 *
 *   1. checks the database answers, and refuses to go on if it does not;
 *   2. drops and recreates the `public` schema, so a run starts from nothing;
 *   3. runs the server's own `migrate`, which also bootstraps the first admin;
 *   4. starts an SMTP sink and a tiny JSON mailbox in front of it, because the
 *      recovery code only exists in the mail;
 *   5. starts `node dist/index.js` on a free port and waits for `/readyz`.
 *
 * `npm test -w @cafe/web` builds the server first (`pretest`), so `dist/` is
 * never stale.
 *
 * The default `TEST_DATABASE_URL` is the server suite's database. That is safe
 * because `npm test --workspaces` runs the packages one after another; running
 * the two suites **at the same time** would have each reset the other's schema.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';
import { SmtpSink } from './smtpSink';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cafe:cafe@localhost:5432/cafe_loyalty_test';

/** The bootstrap admin the harness signs in as. A throwaway credential. */
export const LIVE_ADMIN = { username: 'harness-admin', password: 'harness-password-1' };

const SERVER_DIR = fileURLToPath(new URL('../../../server/', import.meta.url));

declare module 'vitest' {
  export interface ProvidedContext {
    apiBaseUrl: string;
    mailboxUrl: string;
    adminUsername: string;
    adminPassword: string;
  }
}

/** The one thing borrowed from the server package: its Postgres driver, to reset the schema. */
interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}
type PgModule = { Client: new (options: { connectionString: string }) => PgClient };

function loadPg(): PgModule {
  const require = createRequire(new URL('package.json', `file://${SERVER_DIR}`));
  return require('pg') as PgModule;
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(unparseable TEST_DATABASE_URL)';
  }
}

async function resetDatabase(): Promise<void> {
  const { Client } = loadPg();
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      [
        '',
        'The SPA live suite needs a real PostgreSQL database and could not reach one.',
        '',
        `  tried:  ${safeUrl(TEST_DATABASE_URL)}`,
        `  error:  ${reason}`,
        '',
        'These tests are not skipped on purpose: the services are tested against the real',
        'server, and the real server needs a real database (UI-RECONCILIATION.md P6).',
        'Start the same Postgres the server suite uses, or point TEST_DATABASE_URL at one.',
        'Notes: docs/BACKEND-PLAN.md §0, "Running the server tests".',
        '',
      ].join('\n'),
    );
  }
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Runs a server entry point to completion; rejects with its output on failure. */
function runToCompletion(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: SERVER_DIR, env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with ${code}:\n${output}`));
    });
  });
}

async function waitUntilReady(baseUrl: string, server: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`The server exited during startup (${server.exitCode}):\n${log()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The server never became ready at ${baseUrl}:\n${log()}`);
}

/** `GET /messages` → every mail the sink has received, newest last. */
function startMailbox(sink: SmtpSink): Promise<{ server: HttpServer; url: string }> {
  const server = createHttpServer((request, response) => {
    if (request.url !== '/messages') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(sink.received));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

export default async function setup({ provide }: GlobalSetupContext) {
  await resetDatabase();

  const sink = new SmtpSink();
  const smtpUrl = await sink.listen();
  const mailbox = await startMailbox(sink);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOG_LEVEL: 'warn',
    DATABASE_URL: TEST_DATABASE_URL,
    // Plain http on loopback. The harness keeps its own cookie jar and does not
    // care about the flag; a browser would.
    COOKIE_SECURE: 'false',
    APP_URL: 'http://localhost:5173',
    MAIL_SMTP_URL: smtpUrl,
    MAIL_FROM: 'Café Loyalty <cafe@example.test>',
    BOOTSTRAP_ADMIN_USERNAME: LIVE_ADMIN.username,
    BOOTSTRAP_ADMIN_PASSWORD: LIVE_ADMIN.password,
    BOOTSTRAP_ADMIN_NAME: 'Harness Admin',
  };

  await runToCompletion('dist/migrate.js', env);

  let log = '';
  const server = spawn(process.execPath, ['dist/index.js'], { cwd: SERVER_DIR, env });
  server.stdout?.on('data', (chunk) => (log += chunk));
  server.stderr?.on('data', (chunk) => (log += chunk));

  const stop = async () => {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill('SIGTERM');
      await exited;
    }
    await new Promise((resolve) => mailbox.server.close(resolve));
    await sink.close();
  };

  try {
    await waitUntilReady(baseUrl, server, () => log);
  } catch (err) {
    await stop();
    throw err;
  }

  provide('apiBaseUrl', baseUrl);
  provide('mailboxUrl', mailbox.url);
  provide('adminUsername', LIVE_ADMIN.username);
  provide('adminPassword', LIVE_ADMIN.password);

  return stop;
}
