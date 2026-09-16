/**
 * Environment parsing + validation.
 *
 * Every variable the server reads is declared here and validated once, at boot.
 * A missing or malformed value **exits the process** rather than surfacing as a
 * confusing failure on the first request that happens to need it.
 *
 * Nothing in here is ever logged: `DATABASE_URL` carries a password and the
 * bootstrap variables carry a credential.
 */

export type NodeEnv = 'development' | 'test' | 'production';

/** The first admin account, created by `bootstrap.ts` on an empty database. */
export interface BootstrapAdmin {
  username: string;
  password: string;
  pin: string;
  name?: string;
}

/**
 * Outbound mail. All-or-nothing, like {@link BootstrapAdmin}: a half-configured
 * mailer is a deployment mistake that shows up as customers never receiving a
 * recovery code, which is the hardest kind of failure to notice.
 */
export interface MailConfig {
  /** `smtp://user:pass@host:port` (or `smtps://`). Carries a password; never logged. */
  smtpUrl: string;
  /** Envelope sender, e.g. `"Ckyka" <no-reply@example.test>`. */
  from: string;
}

export interface Env {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  /**
   * Public origin of the SPA, used to build the card links in outbound mail. The
   * server cannot infer it — behind Cloudflare the request host is the proxy's
   * and a link built from it would point somewhere the customer cannot reach.
   */
  appUrl: string;
  /** `null` when no SMTP is configured — mail is logged, not sent. */
  mail: MailConfig | null;
  /**
   * `Secure` on the session cookies. Defaults to on under `NODE_ENV=production`
   * and off elsewhere, because plain-HTTP local development cannot receive a
   * `Secure` cookie at all. Setting it to `false` in production is a deployment
   * mistake, and `parseEnv` refuses it.
   */
  cookieSecure: boolean;
  /**
   * Origins accepted on mutating requests besides this server's own. Empty in
   * the deployed bundle, where nginx serves the SPA and the API from one origin;
   * a Vite dev server on another port needs listing.
   */
  allowedOrigins: string[];
  /** `null` when the bootstrap variables are absent — nothing is seeded. */
  bootstrapAdmin: BootstrapAdmin | null;
}

/** Raised for every problem found, so one run reports them all. */
export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

type Source = Record<string, string | undefined>;

function read(source: Source, key: string): string | undefined {
  const raw = source[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Parses and validates the environment. Pure — takes the source explicitly so
 * it is testable without mutating `process.env`.
 */
export function parseEnv(source: Source = process.env): Env {
  const problems: string[] = [];

  const nodeEnvRaw = read(source, 'NODE_ENV') ?? 'development';
  if (!NODE_ENVS.includes(nodeEnvRaw as NodeEnv)) {
    problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')} (got "${nodeEnvRaw}")`);
  }
  const nodeEnv = nodeEnvRaw as NodeEnv;

  const host = read(source, 'HOST') ?? '0.0.0.0';

  const portRaw = read(source, 'PORT') ?? '3000';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be an integer 1-65535 (got "${portRaw}")`);
  }

  const logLevel = read(source, 'LOG_LEVEL') ?? (nodeEnv === 'test' ? 'silent' : 'info');
  if (!LOG_LEVELS.includes(logLevel)) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${logLevel}")`);
  }

  const databaseUrl = read(source, 'DATABASE_URL');
  if (!databaseUrl) {
    problems.push('DATABASE_URL is required (postgres://user:password@host:port/database)');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    // Deliberately does not echo the value — it contains a password.
    problems.push('DATABASE_URL must be a postgres:// or postgresql:// connection string');
  }

  const cookieSecure = parseCookieSecure(source, nodeEnv, problems);
  const allowedOrigins = parseAllowedOrigins(source, problems);
  const bootstrapAdmin = parseBootstrapAdmin(source, problems);
  const mail = parseMail(source, problems);
  const appUrl = parseAppUrl(source, mail !== null, problems);

  if (problems.length > 0) throw new EnvError(problems);

  return {
    nodeEnv,
    host,
    port,
    logLevel,
    databaseUrl: databaseUrl as string,
    appUrl,
    mail,
    cookieSecure,
    allowedOrigins,
    bootstrapAdmin,
  };
}

/**
 * Where the SPA is served.
 *
 * Only outbound mail uses it — it is what the card links in the welcome and
 * reward-available mails point at — so it is **required exactly when mail is
 * configured** and defaults to the Vite dev server otherwise. Tying it to the
 * mailer rather than to `NODE_ENV` is what stops a deployment sending links to
 * `localhost`, which is a silent failure: the mail arrives and the link is dead.
 *
 * Trailing slashes are trimmed so link building can always join with `/`.
 */
function parseAppUrl(source: Source, mailConfigured: boolean, problems: string[]): string {
  const raw = read(source, 'APP_URL');
  if (!raw) {
    if (mailConfigured) {
      problems.push('APP_URL is required when mail is configured (the public origin of the SPA)');
    }
    return 'http://localhost:5173';
  }
  try {
    new URL(raw);
  } catch {
    problems.push(`APP_URL must be a URL (got "${raw}")`);
    return raw;
  }
  return raw.replace(/\/+$/, '');
}

/**
 * SMTP, all-or-nothing. With neither variable set the server runs and *logs*
 * what it would have sent (`LogMailer`) — the right behaviour for a test run or
 * a stack brought up before mailpit, and the wrong behaviour to reach production
 * silently, which is why the absence is warned about at boot rather than being
 * a quiet default.
 */
function parseMail(source: Source, problems: string[]): MailConfig | null {
  const smtpUrl = read(source, 'MAIL_SMTP_URL');
  const from = read(source, 'MAIL_FROM');

  if (!smtpUrl && !from) return null;
  if (!smtpUrl || !from) {
    problems.push('MAIL_SMTP_URL and MAIL_FROM must be set together, or both left unset');
    return null;
  }
  if (!/^smtps?:\/\//.test(smtpUrl)) {
    // Deliberately does not echo the value — it contains a password.
    problems.push('MAIL_SMTP_URL must be an smtp:// or smtps:// connection string');
  }
  // Accepts both `no-reply@example.test` and `"Ckyka" <no-reply@example.test>`.
  if (!/@/.test(from)) {
    problems.push('MAIL_FROM must contain an email address');
  }

  return { smtpUrl, from };
}

/**
 * Defaults to the safe value for the environment and refuses the one
 * combination that is never intentional: a production deployment handing out
 * session cookies that a plain-HTTP request would carry.
 */
function parseCookieSecure(source: Source, nodeEnv: NodeEnv, problems: string[]): boolean {
  const raw = read(source, 'COOKIE_SECURE');
  if (raw === undefined) return nodeEnv === 'production';
  if (raw !== 'true' && raw !== 'false') {
    problems.push(`COOKIE_SECURE must be "true" or "false" (got "${raw}")`);
    return nodeEnv === 'production';
  }
  const secure = raw === 'true';
  if (!secure && nodeEnv === 'production') {
    problems.push('COOKIE_SECURE must not be false in production — session cookies require HTTPS');
  }
  return secure;
}

/** Comma-separated, each a scheme + host with no path, e.g. `http://localhost:5173`. */
function parseAllowedOrigins(source: Source, problems: string[]): string[] {
  const raw = read(source, 'ALLOWED_ORIGINS');
  if (!raw) return [];

  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      problems.push(`ALLOWED_ORIGINS entry "${origin}" is not a URL`);
      continue;
    }
    if (parsed.origin !== origin) {
      problems.push(`ALLOWED_ORIGINS entry "${origin}" must be a bare origin (got "${parsed.origin}")`);
    }
  }
  return origins;
}

/**
 * The bootstrap admin is all-or-nothing: either all three required variables are
 * set or none are. A partially-configured bootstrap is a deployment mistake that
 * would otherwise leave an operator locked out of a running system.
 */
function parseBootstrapAdmin(source: Source, problems: string[]): BootstrapAdmin | null {
  const username = read(source, 'BOOTSTRAP_ADMIN_USERNAME');
  const password = read(source, 'BOOTSTRAP_ADMIN_PASSWORD');
  const pin = read(source, 'BOOTSTRAP_ADMIN_PIN');
  const name = read(source, 'BOOTSTRAP_ADMIN_NAME');

  const present = [username, password, pin].filter((v) => v !== undefined).length;
  if (present === 0) return null;
  if (present < 3) {
    problems.push(
      'BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_ADMIN_PIN must be set together, or all left unset',
    );
    return null;
  }

  if (password!.length < 8) {
    problems.push('BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters');
  }
  if (!/^\d{4,8}$/.test(pin!)) {
    problems.push('BOOTSTRAP_ADMIN_PIN must be 4-8 digits');
  }

  return { username: username!, password: password!, pin: pin!, name };
}

/**
 * Boot-time entrypoint: parse, or print the problems and exit. Keeps the failure
 * mode of a misconfigured container obvious in the logs.
 */
export function loadEnv(source: Source = process.env): Env {
  try {
    return parseEnv(source);
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
