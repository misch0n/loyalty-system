/**
 * Two of BACKEND-PLAN §6's acceptance criteria, as tests rather than as
 * intentions.
 *
 * Both guard against something a backend makes *newly easy to build* — which is
 * exactly why §7 warns about them. A reviewer can miss a helpful-looking route
 * in a diff; a failing test cannot be missed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAuthDeps } from '../auth/guards';
import type { Db } from '../db';
import { PostgresStore } from '../PostgresStore';
import { buildServer } from '../server';
import { testPool } from '../testing/database';

const SERVER_SRC = fileURLToPath(new URL('..', import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);

/** Every server source except this file, which necessarily names what it bans. */
function serverSources(dir: string = SERVER_SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return serverSources(path);
    if (!path.endsWith('.ts') || path === THIS_FILE) return [];
    return [path];
  });
}

/**
 * Comments are stripped before matching. These guards are about what the code
 * *does*, and every one of them is a rule worth explaining in prose right beside
 * the code that honours it — a guard that fires on its own documentation would
 * only teach us to stop writing the documentation.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourcesMatching(pattern: RegExp): string[] {
  return serverSources().filter((path) => pattern.test(code(path)));
}

describe('§4-B — the PIN is never searched for globally', () => {
  it('has no `getStaffByPin` left to call', () => {
    // Until Phase 6 this guard read "no file outside the store may call it": the
    // port demanded the method, so the store implemented it and a grep kept the
    // routes away. The port no longer demands it, so the method is gone and the
    // guard can say the stronger thing — over the network "which account has
    // this PIN?" is an unauthenticated credential oracle across the whole staff
    // table at four digits, and there is now nothing to reach. `POST
    // /auth/unlock` verifies a PIN against the account the session already
    // names.
    expect(sourcesMatching(/getStaffByPin/)).toEqual([]);
  });
});

describe('a short typed code is never consumed globally', () => {
  it('reaches `recovery_codes` only through the scoped module', () => {
    // The scoping IS the security (SCOPE-DECISIONS §2.3): a guess is checked
    // against the codes issued to *one* customer, never against every live code
    // in the café, which would get easier with every customer who asked for one.
    //
    // Phase 6 put that shape on the port itself — `consumeRecoveryCode` cannot
    // be called without naming whose code it is — so the old guard (nothing may
    // call the port pair) has nothing left to forbid. What still needs saying is
    // that nobody writes their own query against the table and scopes it
    // differently, or forgets to.
    const allowed = [join('recovery', 'codes.ts'), 'PostgresStore.ts'];
    const callers = sourcesMatching(/recovery_codes/)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => !allowed.some((suffix) => path.endsWith(suffix)));
    expect(callers).toEqual([]);
  });

  it('reaches `idempotency_keys` only through the store', () => {
    // The commit route used to read this table itself, because `CommitResult`
    // could not say whether it had been served from the cache and the port was
    // not editable (BACKEND-PLAN §4, Phase 4 as-built). It says `replayed` now,
    // and a second reader — racing the store's own transaction — is exactly the
    // disagreement that fix removed.
    const callers = sourcesMatching(/idempotency_keys/)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => !path.endsWith('PostgresStore.ts'));
    expect(callers).toEqual([]);
  });
});

describe('§6 — no post-commit undo was reintroduced', () => {
  it('has no undo, undoCommit or planUndo anywhere in the server', () => {
    // Appendix E replaced the 5-second post-commit undo with a 3-second
    // pre-commit hold, which is purely client-side and needs nothing from the
    // server. `CLAUDE.md`: do not reintroduce these. The only correction
    // primitive is `LoyaltyService.reverse` — a ledger entry, not an erasure.
    expect(sourcesMatching(/\bundo(Commit)?\b|\bplanUndo\b/i)).toEqual([]);
  });
});

describe('§1 — the export surface has no server behind it', () => {
  it('has no route for the retired activity export', () => {
    // SCOPE-DECISIONS §1 dropped the export entirely, which is how BACKEND-PLAN
    // §4-F is "resolved by deletion". Migration 001 already makes the database
    // refuse an `audit.export` row; this stops one being attempted.
    //
    // Tests are exempt: `migrate.test.ts` proves the database rejects that row,
    // which it cannot do without naming it.
    const offenders = sourcesMatching(/exportActivity|audit\.export/).filter(
      (path) => !path.endsWith('.test.ts'),
    );
    expect(offenders).toEqual([]);
  });

  it('reads cross-account audit and ledger rows only where detection needs them', () => {
    // `listAudit` and `listAllTransactions` are unbounded, cross-account reads.
    // SCOPE-DECISIONS §3.1 keeps them as an INTERNAL capability feeding the
    // detectors; `activity.ts` is the only route file allowed to call them, and
    // it pins the audit filter to the session's own actor before it does. A
    // third caller is how a browsable feed gets rebuilt by accident.
    const allowed = ['PostgresStore.ts', 'detection.ts', join('routes', 'activity.ts')];
    const callers = sourcesMatching(/\blistAudit\b|\blistAllTransactions\b/)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => !allowed.some((suffix) => path.endsWith(suffix)));
    expect(callers).toEqual([]);
  });
});

describe('§4 — the routes that must not exist', () => {
  // Grepping for the handler names would not catch these: the store methods
  // behind them are legitimate and stay. What must never appear is an HTTP path
  // reaching them, so the paths themselves are what is banned.
  const BANNED_PATHS = [
    // §4-B — "which account has this PIN?" over HTTP is a credential oracle.
    '/staff/by-pin',
    // `getStaffByUsername` returns the account WITH its argon2id digests. It is
    // the prototype's login lookup; sign-in is `POST /auth/login` here.
    '/staff/by-username',
    // Retired by the rewards rework, and off the port since Phase 6. Migration
    // 001 refuses the `redemption` ledger entry it would write, so there is
    // nothing left for such a route to call.
    '/redeem',
  ];

  for (const path of BANNED_PATHS) {
    it(`has no route declaring ${path}`, () => {
      // Tests are exempt, as they are for the export guard above: `staff.test.ts`
      // proves these paths answer 404, which it cannot do without naming them.
      // The route inventory below is what would catch a real one regardless.
      const offenders = sourcesMatching(new RegExp(`['\`"]${path.replace(/\//g, '\\/')}`)).filter(
        (file) => !file.endsWith('.test.ts'),
      );
      expect(offenders).toEqual([]);
    });
  }
});

/**
 * The route inventory.
 *
 * Every other guardrail in this file bans something by name, which only works
 * for the mistakes already thought of. This one is the opposite: it pins the
 * *whole* surface, so a route added anywhere fails here until someone writes it
 * down — and writing it down means deciding its tier in `authz.test.ts`, which
 * is the decision a helpful-looking new route is most likely to skip.
 */
describe('§6 — the API surface is exactly this', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeAll(async () => {
    // No queries are issued: registering routes never touches the database, and
    // `app.ready()` does not either.
    db = testPool();
    const deps = createAuthDeps({ db, store: new PostgresStore(db), cookieSecure: true });
    app = buildServer({ logLevel: 'silent', auth: deps });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it('registers no route that is not in this tree', () => {
    expect(app.printRoutes({ commonPrefix: false }).trim()).toBe(
      `
├── /auth/session (GET, HEAD)
├── /auth/login (POST)
├── /auth/logout (POST)
│   └── -all (POST)
├── /auth/unlock (POST)
├── /audit (GET, HEAD, POST)
├── /alerts (GET, HEAD)
├── /me (GET, HEAD, PUT, DELETE)
├── /recovery/request (POST)
├── /recovery/consume (POST)
├── /readyz (GET, HEAD)
├── /customers (POST)
│   ├── /by-token/:token (GET, HEAD)
│   ├── /by-code/:shortCode (GET, HEAD)
│   ├── /search (POST)
│   └── /:id (GET, HEAD, PATCH, DELETE)
│       ├── /state (GET, HEAD)
│       ├── /rewards (GET, HEAD)
│       ├── /rotate-token (POST)
│       ├── /transactions (GET, HEAD, POST)
│       ├── /consent (POST)
│       └── /commit (POST)
├── /config (GET, HEAD, PATCH)
├── /staff (GET, HEAD, POST)
│   └── /:id (PATCH, DELETE)
│       ├── /password (PATCH)
│       └── /pin (PATCH)
├── /stats/active-customers (GET, HEAD)
├── /transactions (GET, HEAD)
├── /export (GET, HEAD)
├── /import (POST)
└── /healthz (GET, HEAD)
`.trim(),
    );
  });
});
