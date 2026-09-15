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
import { describe, expect, it } from 'vitest';

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
  it('gives `getStaffByPin` no route', () => {
    // `PostgresStore.getStaffByPin` implements the port and must keep working —
    // the conformance suite holds it to the prototype's answer. What must never
    // exist is an HTTP path that reaches it: over the network, "which account
    // has this PIN?" is an unauthenticated credential oracle across the whole
    // staff table at four digits. `POST /auth/unlock` verifies a PIN against the
    // account the session already names instead.
    const callers = sourcesMatching(/getStaffByPin/).filter(
      (path) => !path.endsWith('PostgresStore.ts') && !path.endsWith('PostgresStore.test.ts'),
    );
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
});
