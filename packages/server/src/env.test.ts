import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env';

const MINIMAL = { DATABASE_URL: 'postgres://user:secret@db:5432/cafe' };

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (err) {
    if (err instanceof EnvError) return err.problems;
    throw err;
  }
  return [];
}

describe('parseEnv', () => {
  it('applies defaults around the one required variable', () => {
    const env = parseEnv(MINIMAL);

    expect(env).toMatchObject({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseUrl: MINIMAL.DATABASE_URL,
      cookieSecure: false,
      allowedOrigins: [],
      bootstrapAdmin: null,
    });
  });

  describe('COOKIE_SECURE', () => {
    it('defaults to the safe value for the environment', () => {
      // Plain-HTTP local development cannot receive a `Secure` cookie at all,
      // and production must never hand one out without it.
      expect(parseEnv(MINIMAL).cookieSecure).toBe(false);
      expect(parseEnv({ ...MINIMAL, NODE_ENV: 'production' }).cookieSecure).toBe(true);
    });

    it('can be turned on for a local HTTPS setup', () => {
      expect(parseEnv({ ...MINIMAL, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
    });

    it('refuses to be turned off in production', () => {
      const found = problems({ ...MINIMAL, NODE_ENV: 'production', COOKIE_SECURE: 'false' });
      expect(found).toEqual([expect.stringContaining('COOKIE_SECURE must not be false')]);
    });

    it('rejects a value that is neither true nor false', () => {
      expect(problems({ ...MINIMAL, COOKIE_SECURE: 'yes' })).toEqual([
        expect.stringContaining('COOKIE_SECURE'),
      ]);
    });
  });

  describe('ALLOWED_ORIGINS', () => {
    it('is empty by default — the deployed bundle is single-origin', () => {
      expect(parseEnv(MINIMAL).allowedOrigins).toEqual([]);
    });

    it('splits a comma-separated list', () => {
      const env = parseEnv({
        ...MINIMAL,
        ALLOWED_ORIGINS: 'http://localhost:5173, https://till.cafe.test',
      });
      expect(env.allowedOrigins).toEqual(['http://localhost:5173', 'https://till.cafe.test']);
    });

    it('rejects anything that is not a bare origin', () => {
      // A trailing path would never match the `Origin` header a browser sends,
      // so accepting it would silently mean "no extra origins at all".
      const found = problems({ ...MINIMAL, ALLOWED_ORIGINS: 'https://cafe.test/app, notaurl' });
      expect(found).toHaveLength(2);
    });
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(problems({})).toEqual([expect.stringContaining('DATABASE_URL is required')]);
  });

  it('rejects a malformed DATABASE_URL without echoing it', () => {
    // The connection string carries a password — the error must not repeat it.
    const found = problems({ DATABASE_URL: 'mysql://user:hunter2@db/cafe' });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('postgres://');
    expect(found.join(' ')).not.toContain('hunter2');
  });

  it('reports every problem in one pass', () => {
    const found = problems({ PORT: '0', LOG_LEVEL: 'chatty', NODE_ENV: 'staging' });

    expect(found).toHaveLength(4); // NODE_ENV, PORT, LOG_LEVEL, DATABASE_URL
  });

  it('rejects a non-numeric or out-of-range PORT', () => {
    expect(problems({ ...MINIMAL, PORT: 'eighty' })).toEqual([expect.stringContaining('PORT')]);
    expect(problems({ ...MINIMAL, PORT: '70000' })).toEqual([expect.stringContaining('PORT')]);
    expect(parseEnv({ ...MINIMAL, PORT: '8080' }).port).toBe(8080);
  });

  it('defaults the log level to silent under NODE_ENV=test', () => {
    expect(parseEnv({ ...MINIMAL, NODE_ENV: 'test' }).logLevel).toBe('silent');
  });

  it('treats blank values as unset', () => {
    expect(parseEnv({ ...MINIMAL, PORT: '   ' }).port).toBe(3000);
  });

  describe('bootstrap admin', () => {
    const ADMIN = {
      BOOTSTRAP_ADMIN_USERNAME: 'manager',
      BOOTSTRAP_ADMIN_PASSWORD: 'correct-horse',
      BOOTSTRAP_ADMIN_PIN: '4321',
    };

    it('parses a complete set', () => {
      const env = parseEnv({ ...MINIMAL, ...ADMIN, BOOTSTRAP_ADMIN_NAME: 'Manager' });

      expect(env.bootstrapAdmin).toEqual({
        username: 'manager',
        password: 'correct-horse',
        pin: '4321',
        name: 'Manager',
      });
    });

    it('is all-or-nothing — a partial set is a deployment mistake, not a default', () => {
      const found = problems({ ...MINIMAL, BOOTSTRAP_ADMIN_USERNAME: 'manager' });

      expect(found).toEqual([expect.stringContaining('must be set together')]);
    });

    it('rejects a short password and a non-numeric PIN', () => {
      const found = problems({
        ...MINIMAL,
        ...ADMIN,
        BOOTSTRAP_ADMIN_PASSWORD: 'short',
        BOOTSTRAP_ADMIN_PIN: 'abcd',
      });

      expect(found).toHaveLength(2);
      expect(found.join(' ')).not.toContain('short');
    });
  });
});
