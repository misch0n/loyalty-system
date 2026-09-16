/**
 * PII-redacting log configuration.
 *
 * `CLAUDE.md`: **never log PII (name/email/phone)** — not in console, not in
 * errors. With a server that rule has to cover request logs too, so redaction
 * lives here rather than being remembered at each call site.
 *
 * Three layers, because each catches what the others miss:
 *  1. **Serializers** — requests and responses are reduced to a fixed safe shape
 *     (method, path, status). Headers, bodies and query *values* never reach the
 *     log at all. This is the important one: it is allow-list, not deny-list.
 *  2. **`redact` paths** — a deny-list for sensitive keys on anything else a call
 *     site chooses to log.
 *  3. **`scrubText`** — a last-resort pattern scrub applied to every log message,
 *     for free text (error messages, database errors) that may have had a value
 *     interpolated into it before it ever reached a serializer.
 */

/** Keys whose values must never appear in a log line, wherever they appear. */
export const SENSITIVE_KEYS = [
  'name',
  'displayName',
  'display_name',
  'email',
  'phone',
  'password',
  'passwordHash',
  'password_hash',
  'pin',
  'pinHash',
  'pin_hash',
  'token',
  'tokenHash',
  'token_hash',
  'recoveryCode',
  'recovery_code',
  'codeHash',
  'code_hash',
  'shortCode',
  'short_code',
  'authorization',
  'cookie',
  'set-cookie',
] as const;

/**
 * Keys that are a secret where a **call site** puts them and load-bearing where
 * the **error serializer** does.
 *
 * `code` is the only one, and it is the reason this list exists at all. Phase 5
 * gave recovery a short typed code, so `{ code }` on a log call is a credential;
 * but `err.code` is a Postgres SQLSTATE (`23505` — unique violation) or a Node
 * error code (`ECONNREFUSED`), which is the single most useful field when
 * diagnosing a 500. Blanket-redacting the key censored both, and Phase 5 worked
 * around it by writing the provider's code into the error *message* instead.
 *
 * So these are redacted under every prefix a call site uses, and deliberately
 * NOT under the one-level wildcard — which is what `err.code` matches. The
 * credential keeps a belt of its own: `recoveryCode`/`recovery_code` are in
 * {@link SENSITIVE_KEYS} above, and a guardrail fails if any server source logs
 * a bare `code` (`routes/guardrails.test.ts`).
 */
export const CALL_SITE_SENSITIVE_KEYS = ['code'] as const;

export const CENSOR = '[redacted]';

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Scrubs values that look like PII out of free text. A safety net for strings
 * assembled elsewhere (a Postgres constraint-violation message quotes the
 * offending value, for instance) — not a substitute for not logging PII.
 */
export function scrubText(text: string): string {
  return text.replace(EMAIL_PATTERN, '[redacted-email]');
}

/**
 * Path prefixes whose next segment is a credential.
 *
 * BACKEND-PLAN §3-B-11 keeps PII out of URLs, and Phase 4 moved customer search
 * to a POST body for exactly that reason. These two are the routes where the URL
 * legitimately carries a *credential* instead: a card's 128-bit token and the
 * short code staff type when the camera fails. Neither is PII — that is the
 * point of the opaque-token design — but both are the thing that grants access
 * to a card, and Phase 3's rule that a credential never reaches a log applies
 * whatever shape it arrives in.
 */
const CREDENTIAL_PATH_PREFIXES = ['/customers/by-token/', '/customers/by-code/'];

/**
 * Reduces a URL to what is safe to log: the path, with the query string dropped
 * whole and any credential-carrying segment replaced.
 */
export function safeUrl(url: string | undefined): string {
  if (!url) return '';
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const suffix = queryAt === -1 ? '' : '?[redacted]';

  for (const prefix of CREDENTIAL_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return `${prefix}${CENSOR}${suffix}`;
  }
  return `${path}${suffix}`;
}

/** Every nesting a sensitive key is plausibly logged under, for pino `redact`. */
const PREFIXES = ['', '*.', 'req.body.', 'req.query.', 'req.params.', 'details.', 'context.'];

/** The one-level wildcard — and so the prefix that `err.code` matches. */
const WILDCARD = '*.';

function redactPaths(): string[] {
  return [
    ...PREFIXES.flatMap((prefix) => SENSITIVE_KEYS.map((key) => `${prefix}${key}`)),
    ...PREFIXES.filter((prefix) => prefix !== WILDCARD).flatMap((prefix) =>
      CALL_SITE_SENSITIVE_KEYS.map((key) => `${prefix}${key}`),
    ),
  ];
}

/**
 * Request serializer. An ALLOW-LIST: whatever is not named here — headers,
 * cookies, body, query values — does not reach the log at all. That is the
 * important half of the redaction, because a deny-list only catches the keys
 * somebody remembered to name.
 */
export function serializeRequest(request: { id?: string; method?: string; url?: string }): {
  id: string | undefined;
  method: string | undefined;
  url: string;
} {
  return { id: request.id, method: request.method, url: safeUrl(request.url) };
}

export function serializeReply(reply: { statusCode?: number }): { statusCode: number | undefined } {
  return { statusCode: reply.statusCode };
}

export function serializeError(error: Error & { code?: string }): {
  type: string;
  code: string | undefined;
  message: string;
  stack: string;
} {
  return {
    type: error.name,
    code: error.code,
    message: scrubText(error.message ?? ''),
    stack: error.stack ? scrubText(error.stack) : '',
  };
}

/**
 * Scrubs the message of every log call, whoever made it.
 *
 * The serializers only cover objects logged under `req`/`res`/`err`. A plain
 * `log.info('… ' + value)` — including ones inside Fastify itself — goes
 * straight to `msg`, which is how the raw request URL leaked past the request
 * serializer during Phase 0. This closes that class of hole rather than the one
 * instance of it.
 */
function scrubArguments(args: unknown[]): unknown[] {
  return args.map((arg) => (typeof arg === 'string' ? scrubText(arg) : arg));
}

/** Fastify/pino logger options. Passed straight to `Fastify({ logger })`. */
export function loggerOptions(level: string) {
  return {
    level,
    redact: { paths: redactPaths(), censor: CENSOR },
    serializers: { req: serializeRequest, res: serializeReply, err: serializeError },
    hooks: {
      logMethod(this: unknown, args: unknown[], method: (...rest: unknown[]) => void): void {
        method.apply(this, scrubArguments(args));
      },
    },
  };
}
