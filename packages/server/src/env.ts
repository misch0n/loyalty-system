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

export interface Env {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
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

  const bootstrapAdmin = parseBootstrapAdmin(source, problems);

  if (problems.length > 0) throw new EnvError(problems);

  return {
    nodeEnv,
    host,
    port,
    logLevel,
    databaseUrl: databaseUrl as string,
    bootstrapAdmin,
  };
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
