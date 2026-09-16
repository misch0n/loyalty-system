# Implementation status

> **Purpose.** A fast, current picture of *what exists and where* for any agent
> picking up this repo. Authoritative requirements remain in
> [`SPEC.md`](SPEC.md); working rules in [`../CLAUDE.md`](../CLAUDE.md).
> **Keep this file current** — see the Scribe role in `CLAUDE.md`.
>
> ### ⚠ 2026-09-16 — the backend now leads and the prototype is being deleted
>
> Two maintainer decisions, recorded in [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md) §6, that change
> how this whole file should be read:
> 1. **The backend is built without consideration for the UI**, and the UI is adjusted afterwards
>    with the backend as ground truth. BACKEND-PLAN's *no UI or service rewrite* promise is
>    revoked. Conflicts are collected in [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md) for the
>    maintainer to confirm — **add to it as you go**.
> 2. **The IndexedDB prototype is retired**, not kept working: `IndexedDbStore`, the PeerJS
>    pairing layer, the transport and wallet adapters, `EmailJsMailer` and the Pages demo went in
>    Phase 6 — **done, 2026-09-16**.
>
> **So everything below describes a prototype that has now been dismantled, not a shipping one.**
> The adapters are gone; the screens that used them are still here and are UI-pass deletions.
> `@cafe/web` (the SPA, physically moved to `packages/web/` in Phase 10) no longer builds, on
> purpose: **9 of its 47 test files fail to load** because they import something Phase 6 deleted
> (the six `tests/services/` suites, which ran on `IndexedDbStore` through
> `tests/helpers/freshStore.ts`, plus `Card`, `EnlargedQr` and `Panel`). The file count dropped
> from 53 to 47 in Phase 10, when the six pure-domain suites moved out into `@cafe/shared`
> (`packages/shared/tests/`) and started passing green on their own — not because any of the 9
> failures were fixed. The release gate for the rest of the backend run is the **`@cafe/shared` +
> `@cafe/server` suites + their `tsc`**; a red `@cafe/web` is expected, not a regression to chase.
>
> **▶ Active initiative — the production backend.** [`BACKEND-PLAN.md`](BACKEND-PLAN.md) is the
> live phase-by-phase plan (Fastify + PostgreSQL + Docker Compose; **Phases 0–6 and 10 done**;
> execution order is now 7 → 8 → 9, UI pass, 11) and
> [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md) is the maintainer's feature triage, which **overrides
> scope statements elsewhere including `CLAUDE.md`** — mandatory name + email, wallet and transport
> seams deleted, no admin stats or export surface. Everything described below is the prototype's
> **current** behaviour and stays true until each item is rebuilt. Work is on branch
> `claude/backend-implementation-2kqb08`.
>
> **✓ Completed initiative:** the rewards-as-objects rework (Appendices C+D + multi-reward) is
> **complete — all phases 0–8 done**. Rewards are now discrete, countable `Reward` objects behind a
> single atomic/idempotent commit (accrue + mint + multi-reward subset redeem); see the
> **"Rewards-as-objects acceptance (C9/D10)"** table + formats subsection below. **Its 5-second
> post-commit undo has since been retired**, replaced by a 3-second pre-commit hold — see the
> Appendix E entry immediately below. Phase-by-phase record in [`REWARDS-PLAN.md`](REWARDS-PLAN.md),
> the reasoning behind every decision in [`REWARDS-DECISIONS.md`](REWARDS-DECISIONS.md). Maintainer
> preferences, assistant conventions, and iOS/deploy/IndexedDB gotchas are in
> [`COLLAB-NOTES.md`](COLLAB-NOTES.md).
>
> **✓ Completed initiative:** the **Appendix E — staff integrity & observability** rework (branch
> `claude/github-pages-deploy-ku4gkj`) is **complete — all phases 0–5 done**. A 3-second
> **pre-commit** hold on the staff counter replaces the old 5-second post-commit undo; suspicious-
> activity detectors are pruned to two (self-dealing, repeat-target), rebuilt against real
> attributed audit events, and their thresholds are admin-configurable; ambient activity feeds
> (admin home, StatDetail, per-account history) are removed in favour of a bounded staff "last
> hour" view and an admin **reason-gated JSON export** workflow (itself audited). See the
> **"Staff integrity & observability acceptance (E9)"** table below and phase-by-phase record in
> [`INTEGRITY-PLAN.md`](INTEGRITY-PLAN.md).

**Last updated:** 2026-09-16 (**Backend — Phase 10: the monorepo flip** (branch
`claude/backend-implementation-2kqb08`)). A file move plus the config to make it real — nothing
moved in or out of the product. The repo is now a **three-package npm-workspaces monorepo**.
**`@cafe/shared`** (`packages/shared/src/domain/` + `packages/shared/src/ports/`, tests at
`packages/shared/tests/`) is the pure contract. **`@cafe/server`** (`packages/server/`) is
unchanged in location. **`@cafe/web`** (`packages/web/`) is the React SPA — `App.tsx`, `main.tsx`,
`adapters/`, `config/`, `qr/`, `services/`, `ui/`, plus `index.html`, `public/`, the Vite/Vitest/
tsconfig files and `.env.example`, all moved under `packages/web/src/`, `packages/web/tests/`,
`packages/web/e2e/` and `packages/web/`. `tests/conformance/dataStoreConformance.ts` moved to
**`packages/server/src/testing/dataStoreConformance.ts`** — Phase 6 had already deleted its only
other consumer (`IndexedDbStore`), so the suite now lives beside the one store (`PostgresStore.test.ts`)
it specifies; the `@cafe/conformance` alias is gone. The root `package.json` is a workspace root
only — no SPA dependencies, no `vite`/`vitest` scripts of its own — it delegates
(`npm run build|test|typecheck --workspaces`, `npm run dev -w @cafe/web`).
**`@cafe/shared` is now a real package, not a path alias**: it resolves through the `exports` map
in its own `package.json` the same way for `tsc`, `vitest` and a running `node`; consumers import
`@cafe/shared/domain/<name>` / `@cafe/shared/ports/<name>`. Both the tsconfig `paths` alias and the
duplicate Vite alias are deleted; consumers build it first via a `pretest`/`prebuild`/`predev`
script. This retires the **two-compilers mismatch Phase 4 worked around**: `domain/` and `ports/`
now have exactly one compiler — `packages/shared/tsconfig.json` (`strict`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `NodeNext`, `lib: ["ES2023", "DOM"]`,
`types: []`, no ambient Node types) — where before the SPA checked them loosely and the server,
through the alias, checked them strictly (why Phase 4 had to hand-fix `domain/alerts.ts` for index
safety). Flipping the single strict config on required the same pure, behaviour-preserving
index-safety fix in `domain/insights.ts`, plus two `!` assertions in the moved domain tests.
**The server now emits and runs on plain `node` — `tsx` is no longer its runtime**, closing the
item flagged open in BACKEND-PLAN's "Phases 0–1 as built" notes. `packages/server/tsconfig.json`
moved `moduleResolution: Bundler` → `NodeNext` (+`esModuleInterop`); every relative specifier in
`packages/server/src` and `packages/shared/src` gained its `.js` extension; a new
`packages/server/tsconfig.build.json` emits `dist/` from production code only (excludes
`**/*.test.ts` and `src/testing/`). Server scripts: `start` = `node dist/index.js`, `migrate` =
`node dist/migrate.js`, `bootstrap` = `node dist/bootstrap.js`; only `dev` still uses `tsx watch`.
Verified live, not just by typecheck: migrate, bootstrap, boot, `/healthz`, `/readyz`, sign-in and
a customer registration all ran from `dist/` on plain `node`, log checked afterwards — no PII.
**Verification.** `@cafe/shared` builds, typechecks, and passes **73 tests** (the six domain
suites) — green independently of the SPA, which is why those tests moved out rather than staying
in the knowingly-red web package: the server depends on `domain/`, so the contract's tests
shouldn't sit inside a red package. `@cafe/server` is unchanged from the Phase 6 baseline: **390
tests pass**, `tsc` green, `dist/` emits and runs. `@cafe/web` is still red, for **exactly** the
Phase 6 reasons and no new ones — **9 of 47 test files fail to load, 38 pass (189 tests)**; the
counts only changed because the six domain suites (73 tests) moved out: 53−6=47, 44−6=38,
262−73=189. Every remaining `tsc` error is still a Phase 6 deletion (`adapters/sync/`,
`wallet/passes`, `IndexedDbStore`, the removed `Services` fields, the reshaped port); the one
unresolved `@cafe/shared` import is `@cafe/shared/ports/Transport`, deleted on purpose in Phase 6.
One guardrail widened: `packages/server/src/routes/guardrails.test.ts` now exempts `src/testing/`
wherever it already exempted `*.test.ts` (the conformance suite legitimately calls `listAudit`) —
the same line `tsconfig.build.json` draws; guards that exempt nothing (`undo`, `getStaffByPin`)
still scan every file. **Known gap, not fixed here:** `packages/web/.env.example` moved unedited
and is stale — it still documents EmailJS, TURN and the `VITE_TRANSPORT`/`VITE_DATASTORE` flags
Phase 6 deleted; left for the UI pass.

**Previously:** 2026-09-16 (**Backend — Phase 6: the prototype retired, the shared port
reshaped** (branch `claude/backend-implementation-2kqb08`)). The phase with two halves, and the
second was the work. **Deleted:** `IndexedDbStore` + `schema.ts` + `demoSeed`, the whole PeerJS
pairing layer (`src/adapters/sync/`), `src/adapters/transport/` + `ports/Transport.ts`,
`src/adapters/wallet/` + `ports/WalletProvider.ts` + `src/wallet/` (the preset card tokens with
it), `EmailJsMailer`, the `VITE_TRANSPORT`/`VITE_WALLET`/`VITE_DATASTORE`/`isPrototype` adapter
flags, the GitHub Pages deploy workflow, and the `peerjs` + `idb` dependencies. **Reshaped:**
BACKEND-PLAN §4's six contract problems, each of which had been worked around at the route
boundary only because `ports/DataStore.ts` could not be edited. `setStaffPassword` and
`CreateStaffInput` now say **`password`**, which is what every caller always passed —
`passwordHash` was a name that invited a store to write the digest it was handed and make that
digest a working credential. **`getStaffByPin` and `redeemReward` are gone from the port and the
store**, so §4-B's credential oracle is not something a guardrail keeps callers away from, it is
something that does not exist. The recovery pair took the **scoped** shape `recovery/codes.ts`
already implemented, so there is one implementation instead of two-plus-a-guardrail.
**`CommitResult` carries `replayed`**, and `routes/shared.ts` stopped reading `idempotency_keys`
behind the store's back. `appendAudit` and the recovery trio moved off `DataStore` onto a new
**`TrustedStore`**, the capabilities a client may not have — a type, now, rather than a grep. And
`Snapshot` gained **`rewards` + `rewardEvents`** (§3-A-6, snapshot version **7**), so a restore no
longer silently drops the free coffee a customer was owed; recovery codes are deliberately still
absent, being credentials that expire fifteen minutes after they are issued. The conformance suite
**kept**, reframed in its own header as `PostgresStore`'s specification rather than a cross-store
contract, with the missing second harness explained rather than merely missing. Two new claims were
**verified by breaking them**: deleting the `replayed` stamp fails 4 tests, and dropping `rewards`
from the export fails the round-trip. **+1 server test → 390**, none skipped. The SPA is knowingly
red — see the box above — and every screen-level consequence is a row in
[`UI-RECONCILIATION.md`](UI-RECONCILIATION.md). Divergences **aa–ad** record the port's new shape.
Prior — (**Backend — Phase 5: the server-side `Mailer` + the recovery flow**
(branch `claude/backend-implementation-2kqb08`)). Mail leaves the browser and recovery becomes a
**typed code** (SCOPE-DECISIONS §2.3). New under `packages/server/src/`: **`mail/`** —
`SmtpMailer` (nodemailer; mailpit in dev, SES/Brevo/Resend in production, all over one
`MAIL_SMTP_URL`), `LogMailer` as the unconfigured fallback with a boot-time warning, and
`templates.ts`, which moves the three mail bodies out of an EmailJS dashboard and into the
repository — **`recovery/codes.ts`** and **`routes/recovery.ts`** (`POST /recovery/request` ·
`POST /recovery/consume`, both public), and **`background.ts`**. The phase's two claims are both
tested directly. *The round trip works:* a code is mailed, typed back hyphenated and in lower case,
and the card is bound to the device that typed it by an HttpOnly cookie — proved end to end through
a real SMTP socket, not a double. *An unknown address is indistinguishable from a known one:* the
same 202 and the same body, and the **same timing**, because the lookup and the send happen after
the response as background work; every way a consume can fail answers one `invalid_code`. What
makes six characters safe is stated where it is enforced — the guess is checked **against the card
that asked for it** (never globally, the recovery twin of §4-B's PIN inversion, with a guardrail to
keep it that way), wrong guesses are counted **durably** in `recovery_codes.attempts` so a restart
does not buy five more, and issuing a code supersedes the last one. The **welcome and
reward-available mails move to the routes** — the route is what knows a card was created or a
reward minted, and a replayed commit sends nothing, for the same reason it writes no audit rows;
**Phase 6 must wire the SPA with `NoopMailer`** or every mail goes out twice. New env:
`MAIL_SMTP_URL` + `MAIL_FROM` (both or neither) and `APP_URL`, required once mail is configured
because a card link pointing at `localhost` is a silent failure. Five security-critical rules were
**deleted to confirm the tests fail without them** (the per-address scoping, the `attempts`
predicate, code superseding, the constant-shape response, the till refusal on consume), and the
whole flow was then driven over a real socket with `curl` against a live SMTP sink, with the log
checked afterwards for the name, address, phone, card token, short code, recovery code and both
session tokens — none present. Divergences **x–z** record the shape changes. **+74 server tests →
389**, none skipped; the SPA's **461** and every file under `src/` are untouched. Prior —
**Backend — Phase 4: the HTTP API surface + the authorization
boundary**. Every `ApiStore` path now has a route
behind it, on three tiers built on Phase 3's `requireStaff`/`requireAdmin`. New under
`packages/server/src/routes/`: **`customers.ts`** (registration, card reads, the counter commit,
corrections, tombstone deletion), **`identity.ts`** (`GET/PUT/DELETE /me` — the `IdentityStore`
port behind the HttpOnly cookie, which is the answer to the iOS ITP durability gap),
**`staff.ts`**, **`config.ts`**, **`activity.ts`**, **`snapshot.ts`**, plus **`shared.ts`**,
**`config/clamp.ts`** and **`detection.ts`**. BACKEND-PLAN §4's contract problems are closed in
code, each verified by deleting the fix and watching the test fail: **§4-C** — the routes write
their own audit rows from the session actor and `POST /audit` writes nothing; **§4-D** — the body's
`staffId` is discarded, so a till claiming to be a colleague is recorded as itself and a customer's
device cannot commit at all; **§4-E** — `GET /transactions` demands a range and caps its page, and
**`GET /audit` is pinned to the caller's own actor whatever the filter says**, at every tier;
**§4-F** — there is no export route, and the database already refuses an `audit.export` row.
Cross-account data is reachable only as **findings**: `GET /alerts` (admin) runs `domain/alerts.ts`
**unchanged** server-side over the audit rows the routes now author — which is the whole reason
SCOPE-DECISIONS §3.1 reinstated server-written audit. Also closed: the token is **generated by the
server** at registration, name + email are **required** (§2.1) with one card per address (§3.4),
customer search moves from a query string to **`POST /customers/search`** (§3-B-11) and the two
credential-carrying path segments are redacted from logs, `PATCH /config` clamps server-side and
**refuses a client-supplied `sessionEpoch`**, and **no route serializes a `StaffAccount` whole** —
`GET /staff` and `GET /export` blank the digests. A **route-inventory guardrail** pins the whole
surface, so a new route fails the build until its tier is written into the **authorization matrix**
(`routes/authz.test.ts`) — every route × five real devices, proving each tier is refused everything
above it. Divergences **r–w** record the shape changes. The whole flow was then driven over a real
socket with `curl` and the log checked for the name, address, phone, password, PIN, card token,
short code and both session tokens — none present. **+107 server tests → 315**, none skipped; the
SPA's **461** are unchanged. One `src/` file was touched, and only one: `domain/alerts.ts` needed
index-safe access to compile under the server's `noUncheckedIndexedAccess` (a pure refactor — see
the plan's "Phase 4 — as built"). Prior — **Backend — Phase 3: auth — sessions, idle lock,
revocation, rate limits**. The staff session moves off the device
and onto the server. New under `packages/server/src/`: **`auth/sessions.ts`** (the `sessions` table
behind an HttpOnly `SameSite=Lax` cookie, for staff **and** customers — tokens 256-bit random,
SHA-256 at rest so a dumped database yields no live sessions), **`auth/guards.ts`** (session
resolution + the CSRF boundary on every request, `requireStaff`/`requireAdmin` for Phase 4 to build
on), **`auth/rateLimit.ts`**, **`auth/cookies.ts`**, and **`routes/auth.ts`** — five routes:
`POST /auth/login`, `/auth/unlock`, `/auth/logout`, `/auth/logout-all` and a public
`GET /auth/session` for boot reconciliation. **BACKEND-PLAN §4-A closes by verifying rather than
comparing**: the route takes the plaintext over TLS and calls `argon2.verify` against what the
store hashed, and a test sends the stored digest *as the password* and expects a 401 — if the
server compared, the hash would be the password. **§4-B closes by inverting the lookup**: the PIN
is verified against the account the session already names, never searched for across the table, so
a device with no session cannot PIN in at all (divergence **p**). The **idle lock and epoch
revocation are now the server's** — 5 minutes of inactivity locks a remembered terminal and ends a
non-remembered one, a disabled or deleted account loses its live sessions at once, and "sign out
all devices" deletes every staff session row in the same transaction as the epoch bump, which is a
**counter** (`+1`) because a `Date.now()` epoch overflows the `integer` column (divergence **q**).
Customer sessions share the table and obey neither rule — they never idle out, and staff revocation
leaves them alone. Hardening: a session-bound **double-submit CSRF token** (delivered in a
deliberately readable cookie — a token the page cannot read is a token it cannot submit), a
**same-origin check** on every mutating request (which is what covers sign-in, the one request with
no session to bind a token to), **failure-counting lockouts** (5 per account, 20 per source
address, 5 per account on the PIN), and **one error shape for every failure** so a validation
message can never echo a submitted value. The CSRF check, the origin check, the epoch comparison
and the idle rule were each **deleted to confirm the tests fail without them**, and the whole flow
was driven over a real socket with `curl`, with the log then checked for the password, the PIN and
both tokens — none present. **+102 server tests → 208**, none skipped; the SPA's **461** and every
file under `src/` are untouched. Prior — **Backend — Phase 2: `PostgresStore` + the shared
conformance suite**. The core of the
[`BACKEND-PLAN`](BACKEND-PLAN.md) initiative. **`packages/server/src/PostgresStore.ts`** implements
all 33 `DataStore` methods against PostgreSQL — hand-written SQL, no ORM — and
**`tests/conformance/dataStoreConformance.ts`** is a new store-agnostic suite run against **both**
adapters: `IndexedDbStore` (from the SPA's test run) and `PostgresStore` (from the server's). The
suite is *imported, never copied*, for the same reason `domain/` and `ports/` are — a second copy
of the contract is a contract that drifts. `tests/adapters/IndexedDbStore.test.ts` was trimmed to
what is genuinely IndexedDB-specific (the seed, the short-code backfill, the clean-reset upgrade
and wedged-database self-heal, `reset()`, and the retired `redeemReward` path); everything that is
port behaviour moved into the shared suite. **`commitCounterTransaction` now takes
`SELECT … FOR UPDATE` on the customer row** before it reads or writes anything, which is what
divergence **l** was waiting for: two tills scanning the same card serialize instead of
interleaving, and a deliberately-held-open race test proves it (it fails when the lock is removed
— the earlier `Promise.all` version passed either way, which is why the races below are all held
open by a third connection rather than left to scheduling). A same-key retry is caught twice over:
under the lock, and failing that by the idempotency primary key, which rolls the loser's writes
back and replays the winner's result. Deliberate, load-bearing divergences from the prototype
adapter, each with its own test: credentials are **hashed with argon2id in the store** and never
stored as given (BACKEND-PLAN §4-A), recovery codes are hashed at rest, `softDeleteCustomer`
**erases the token and short code** so a dead card can never be scanned again and its address is
freed (SCOPE-DECISIONS §3.3), a tombstone **cannot be committed against**, and `redeemReward`
**throws** rather than writing the retired `'redemption'` ledger entry the schema refuses —
refusing loudly beats an `ok: false` staff would read as "not enough points". `getStaffByPin`
verifies against each active account (a hashed PIN cannot be looked up by value); it works, and it
must never become a route — BACKEND-PLAN §4-B. **+41 SPA tests** (the conformance suite against
IndexedDB) less 28 now-shared duplicates → **461 Vitest tests**; **+56 server tests** → **106**,
none skipped, against a real Postgres. Prior — **Backend — Phases 0 + 1.** First code of the
[`BACKEND-PLAN`](BACKEND-PLAN.md) initiative. **Phase 0** turned the repo into an npm-workspaces
monorepo (root `package.json` gains `"workspaces": ["packages/*"]`; **`src/` is not moved** — the
physical flip is Phase 10) and scaffolded **`packages/server`** (`@cafe/server`): Fastify 5 + `pg`
+ `argon2`, `src/env.ts` (every variable validated at boot, process **exits** on a missing or
malformed one), `src/server.ts` (`/healthz` liveness — deliberately does *not* touch the database
— and `/readyz` reporting DB reachability with a 503, plus graceful `SIGTERM`/`SIGINT` shutdown),
`src/logging.ts`, `src/db.ts` (pool + `withTransaction`), `src/hashing.ts` (argon2id, hashed
**server-side from the plaintext** — BACKEND-PLAN §4-A). `domain/` and `ports/` are **imported,
never copied**, through the `@cafe/shared/*` alias; the server runs on `tsx` because the shared
sources use extensionless specifiers (see the plan's "Phases 0–1 — as built"). **Phase 1** added
`migrations/001_initial.sql` — the **ten tables** (`program_config`, `staff_accounts`, `customers`,
`loyalty_transactions`, `rewards`, `reward_events`, `idempotency_keys`, `recovery_codes`,
`audit_log`, and the `sessions` table the prototype never needed) mirroring IndexedDB **v6**, plus
the integrity IndexedDB cannot enforce: **name + email NOT NULL on active cards** and **one card
per email** (SCOPE-DECISIONS §2.1/§3.4 — this is where token-only accounts end), the
**tombstone** CHECK pair (§3.3: a deleted row keeps `id`/`created_at`/`status` and erases
everything that resolves to a person, freeing the address for re-registration), short codes unique
among *active* cards, **no PIN-uniqueness constraint** (§3.6 — unimplementable against argon2id
hashes), and **append-only triggers** on `loyalty_transactions`/`reward_events`/`audit_log`. Two
CHECKs enforce retired scope directly in the database: the ledger rejects `'redemption'` and the
audit log rejects **`'audit.export'`** (the export surface is gone — BACKEND-PLAN §4-F resolved by
deletion). `src/migrate.ts` applies numbered forward-only files under an advisory lock, records
each with a checksum, and **refuses a file that changed after being applied**; `src/bootstrap.ts`
creates the first admin from the environment, idempotently and **never** `demoSeed`. **PII
discipline found a real hole:** Fastify's *default* 404 handler logs the raw request URL, sailing
past the request serializer — fixed with a custom `setNotFoundHandler` and a pino `logMethod` hook
that scrubs every message; both are regression-tested. **50 new server tests** (`npm test -w
@cafe/server`, against a real Postgres at `TEST_DATABASE_URL`); the SPA is **completely
unaffected** — `git diff` over `src/` is empty and its **448 tests**, tsc and production build are
unchanged. Next: **Phase 2** (`PostgresStore` + the shared conformance suite). Prior — 2026-09-01 (**Appendix E — staff integrity & observability — COMPLETE, all
phases 0–5** (branch `claude/github-pages-deploy-ku4gkj`)). **Phase 0** replaced the staff Scan's
post-commit undo with a **3-second pre-commit hold**: the counter panel STAGES a transaction and
blocks on a countdown summarizing exactly what's about to be written (points, redemptions, and
rewards it will mint — previewed client-side via `domain/rewards.ts` `mintFold`) with Cancel /
"Commit now"; nothing touches the store until the window elapses, the idempotency key is
allocated at stage time (no double-write race between an early commit and the timeout), and on
success the terminal auto-advances to the scanner. **Phase 1** deleted the now-dead post-commit
undo machinery — `DataStore.undoCommit` (+ `ApiStore`/`IndexedDbStore` impls), `LoyaltyService.undo`,
`domain/rewards.ts` `planUndo`/`UndoPlan`/`CommittedEffect`, and the sync allow-list entry — while
keeping `LoyaltyService.reverse` (the §6 correction primitive, confirmed independent of `planUndo`)
and the `idempotencyKeys` store (still guards paired-device RPC retries). The `reward.voided` event
type is kept per the locked decision but **currently has no producer** in the prototype (a
production `reverse` would void) — see Known gaps. **Phase 2** rebuilt the alert detectors: `AlertKind`
shrank from six to **`'self-dealing' | 'repeat-target'`** (velocity/oversized-multi-add/off-hours/
outlier-share deleted — they fired on ordinary one-café trading); self-dealing is rebuilt against a
real source (the old `type==='redemption'` ledger match had been silently firing on nothing since the
rewards-as-objects rework stopped writing that type — the bug this phase fixes) by pairing attributed
`loyalty.accrue`/`loyalty.redeem` audit rows via a new `AttributedEvent` list assembled in
`LoyaltyService.getAlerts`; thresholds (`selfDealWindowSec`/`selfDealCount`/`repeatWindowMin`/
`repeatCount`) moved onto `ProgramConfig`, defaulted in `DEFAULT_CONFIG`, sanitized in
`ConfigService`, and editable in the admin Configure panel's new "Activity alerts" group. No role
exemption; alerts still only surface, never block. **Phase 3** re-scoped activity surfacing: the
staff terminal's "Today on this terminal" became **"Your last hour"** (actor-scoped, ≤10 rows, no
pager/"Load all"); the admin home's cross-account Activity feed is deleted (the all-audit read
survives only as the aggregate behind "active members today"); `StatDetail` dropped its per-action
`EntryList`; `AccountSheet` lost its per-profile activity history (keeps enable/disable/reset/delete).
**Phase 4** added an investigation & export workflow: `AuditFilter` gained `actions`/`actorIds`
(OR-within/AND-across, unioned with the singular forms) and an inclusive `from`/`to` range read
through the previously-unused `byTimestamp` index; a new `audit.export` `AuditAction`; new
`AuditService.exportActivity(actor, filter, reason)` (refuses an empty reason, trims/caps it at 300
chars, writes an `audit.export` row recording reason + filter + row count); a new admin **Export**
sheet — blank by default, Run disabled until a reason is typed, accounts include admins, results
download as JSON (not an on-screen feed), past exports are listed and re-runnable (a re-run is a new
audited export prefixed "Re-run:"). Admin-only, not step-up gated. **Deferred (not dropped):** the
staff-facing disclosure surface, notify-on-export, retention/compaction (all data kept, unbounded),
device-ID per-terminal scoping (inherited at the production move), and geofence/out-of-hours lock —
see Known gaps. **448 Vitest tests** (up from 435: +6 Scan hold, −10 undo, +3 net
detector/config, +4 activity-surfacing, +10 export), tsc + production build green. **Phase 5
(this pass) is docs only** — see the new **"Staff integrity & observability acceptance (E9)"**
table, the retired/updated C9·D10 undo rows, divergences **m–o**, and the refreshed Known gaps
below. Prior — **Rewards-as-objects — Phase 8 (docs).** Final step of the
[`REWARDS-PLAN`](REWARDS-PLAN.md) rework — **docs only, no code**. Recorded the rewards-as-objects
model across the docs: the SPEC §15 acceptance rows the rework touched now point at the unified
commit (`LoyaltyService.commit` → `DataStore.commitCounterTransaction`) instead of the retired
`accrue`/`redeem`/`redeemReward` path; a new **rewards-as-objects acceptance table (C9/D10)** maps
every criterion from REWARDS-PLAN §5 to its test; and a new **"Rewards-as-objects: formats + undo
model"** subsection documents the reward token / reward short code / card-scan (`/c`) +
reward-scan (`/r`) QR-URL formats and the 5-second undo semantics (reverse net points · void
freshly-minted unspent rewards · re-mint a point-neutral replacement per spent reward — a spent
reward is never un-spent). Divergence **l** (commit atomicity = IDB-tx scope, no row lock) and the
**JSON-snapshot gap** (export/import doesn't carry the three v5 stores) were already on file.
`README.md` refreshed to the discrete-reward model: the accrual/redemption flow diagram and the ER
model gain `Reward` + `RewardEvent`, the ledger `type` drops `redemption` for `reward_issue`, the
feature table describes the one-commit accrue+mint+redeem flow + 5s undo, and the seed threshold is
corrected to **8**. Ticked the Phase 8 box in REWARDS-PLAN — the rework is complete. **435 Vitest
tests**, tsc + build all green (unchanged — docs only). Prior — **Rewards-as-objects — Phase 7 (wallet hooks).** Aligned the
wallet seam with the discrete reward model (REWARDS-PLAN Phase 7). **`WalletProvider`**'s
`WalletDerivedState` swaps the old `rewardAvailable: boolean` for **`rewardCount: number`** — the
count of unspent reward objects the customer holds (the "N free coffees" the card shows), alongside
the settled `balance` (0..threshold−1). The staff Scan's best-effort `pushWallet` now sends
`rewardCount: (next.rewards ?? []).length` instead of `length > 0`; `StaticWalletProvider.pushUpdate`
stays a deliberate Free-tier no-op and `ServerWalletProvider.pushUpdate` still throws (placeholder) —
only the payload shape changed. **Wallet redemption** needs no new code: a baked wallet pass embeds
the **card** scan URL (`…/#/c/<token>?s=w`, maintainer-provisioned), so a wallet scan resolves as a
plain card scan (source `'w'`, no reward tokens) and the staff Scan surfaces the **redeem checklist**
from the customer's unspent rewards generically — **a wallet pass never carries a composite reward QR**
(that lives only in the in-app `EnlargedQr` redeem overlay). **Maintainer action item (confirm):** the
baked pass barcode should be the `…/#/c/<customerToken>?s=w` card URL; `parseScan` is backward-compatible
so older `…/#/status/<token>` baked passes still resolve (card, source `'a'`). **+1 assertion** (Scan
commit test now asserts `pushUpdate('c1', { balance, rewardCount })`) — **435 Vitest tests**, tsc + build
all green. Phase 8 (docs: divergences + acceptance rows) is the remaining rework step. Prior — **Rewards-as-objects — Phase 6 (customer card UI).** Reworked the
customer card surface onto the discrete reward model (REWARDS-PLAN Phase 6). The **Card screen**
(`ui/screens/customer/Card/`) now resolves its reward-aware state the same way the staff Scan does —
`getStateByToken(token)` to resolve token→id, then **`getState(id)`** for the canonical
`CustomerState` (settled balance 0..threshold−1 + the discrete unspent **`rewards`** list). The
sage/blush background and the reward entry are driven by **`rewards.length > 0`** (unspent count), not
the old `rewardAvailable` boolean / `progress.rewardsAvailable`. **`LoyaltyCard`**
(`ui/components/LoyaltyCard/`) takes the unspent `rewards: Reward[]` (replacing the
`rewardReady`/`rewardsAvailable` props): ≥1 reward shows the sage **reward entry** (tap → the FIRST
reward's QR, a 1-element composite); **2+** shows a **count badge** (cup glyph + N) that, on tap,
**expands a selectable picker** (first preselected) and **morphs into a QR icon** — tapping it composes
the **selected** reward ids into one reward QR, and a **`×N`** multiplier shows by the label. The chosen
reward tokens flow up via the new **`onRedeem(rewardTokens: string[])`** callback (was `() => void`).
The shipped botanical redeem overlay (**`EnlargedQr`**) now encodes the **reward QR**
(`rewardScanPayload(tokens, customerToken)` → `…/#/r?ids=<tok,…>&c=<token>&s=a`) instead of the card QR
when opened in redeem mode (new **`rewardTokens`** prop; single vs. composite copy: "Your free
coffee(s)"); the plain enlarged view still shows the card QR + wallet button (wallet resolution skipped
in redeem mode). The transitional service methods (`getStateByToken`/`getStateById`/`getStateByShortCode`
+ `rewardAvailable`/`progress.rewardsAvailable`) remain — both reworked UIs (Scan, Card) now consume the
new `getState` path, so they can be retired in a later cleanup. **+5 tests** (LoyaltyCard single-tap
→ first token, badge-expand → composite-of-selected with `×N`; Card reward-aware fetch + multi-reward
badge; EnlargedQr card-QR vs reward-QR payload + plural copy) — **435 Vitest tests**, tsc + build all
green. The Phase-8 docs pass will record the reward/QR formats + acceptance rows. Prior — **Rewards-as-objects — Phase 5 (scan parser + staff Scan UI).** Reworked
the staff counter onto the unified rewards-as-objects commit (REWARDS-PLAN Phase 5). New **`parseScan`**
(`qr/encode.ts`) collapses every scanned code into one uniform shape
`{kind:'card'|'reward', customerToken, rewardTokens[], source:'a'|'w'}`: a card QR
(`…/#/c/<token>?s=a|w`), a composite reward QR (`…/#/r?ids=<tok,…>&c=<token>&s=a`, 1..N reward tokens =
a 1-element-or-more composite), and — backward-compatibly so old baked wallet passes never hard-fail —
legacy `…/#/status/<token>` URLs and bare tokens (→ card, source `'a'`). New `cardScanPayload` /
`rewardScanPayload` builders emit those shapes (used by the card/wallet QR in Phases 6–7);
`ui/app/routes.ts` documents the two **scan-payload-only** paths (`SCAN_PAYLOADS`) — deliberately NOT
mounted as react-router routes (`/c` and `/r` are staff-scan URLs, never customer-facing). The **staff
Scan screen** (`ui/screens/staff/Scan/`) drops the old two-call accrue/redeem/reverse flow for a single
**unified counter panel**: a points slider (now `min=0` so redeem-only is valid) **and** a reward
checklist built from the customer's unspent rewards and **pre-checked from the scanned reward tokens**
(scanned tokens that no longer match an unspent reward surface as "already used"). One **`loyalty.commit`**
call (accrue + mint-on-cross + redeem-N, atomic + idempotent — a fresh `idempotencyKey` per attempt)
replaces the separate buttons; the success result's `state` refreshes the card in place, and an
`over_cap` rejection shows the per-scan-limit error. A new **committed** sub-state shows what happened
(added · redeemed · minted) with a **5-second Undo** affordance (`loyalty.undo` → reverse points, void
fresh mint, re-mint a replacement per spent reward) before "Scan next". State resolves via
`getStateByToken`/`getStateByShortCode` (token→id) → `getState(id)` for the reward-aware view. **+8 tests**
(parseScan card/reward/composite/legacy/source matrix; Scan resolve + slider-tracked commit, reward
pre-check + redeem, Undo affordance, over_cap error) — **430 Vitest tests**, tsc + build all green. The
Phase-8 docs pass will record the new scan-URL/reward-QR formats and the undo model as acceptance rows +
any divergences. Prior — **Rewards-as-objects — Phase 4 (sync / RPC allow-list).** Opened the
unified-commit contract over the prototype device-pairing seam (REWARDS-PLAN Phase 4). The sync
allow-list (`adapters/sync/storeMethods.ts`) — the single source of truth both `PeerClientStore`
(client proxy) and `StoreServer` (host dispatch) read from — gains **`commitCounterTransaction`**,
**`listRewards`**, **`getCustomerState`**, and **`undoCommit`**, so a paired client device now drives
the reward model through the till over RPC exactly as a local store would. `commitCounterTransaction`
and `undoCommit` are also registered as **mutating** (they push the `changed` refetch envelope); the
store's real `idempotencyKey` dedup makes the 10s RPC-retry path safe — a retried commit returns the
cached result and never double-applies. Also closed a pre-existing gap: **`deleteStaff`** was a
`DataStore` method missing from the allow-list, so admin account deletion would have failed on a paired
client — added (mutating). No adapter logic changed — `PeerClientStore`/`StoreServer` are list-driven.
**+1 test** (sync round-trip: client commit lands on the host; same-key retry → identical result, one
accrual, settled balance unchanged) — **422 Vitest tests**, tsc + build all green. Prior — **Rewards-as-objects — Phase 3 (services).** Wired the
unified-commit store contract through `LoyaltyService` (REWARDS-PLAN Phase 3). New
**`commit(actor, input)`** wraps `DataStore.commitCounterTransaction` (accrual + mint-on-cross +
redeem-N in one atomic, idempotent call) and — since the store writes no audit — appends the
trail itself: one `loyalty.accrue` row when points were added and one `loyalty.redeem` row per
reward actually spent, each tagged with the scan `source` (`'a'`/`'w'`; recorded for analytics,
drives nothing else). It sends exactly **one** best-effort reward-available email per commit, only
when the commit minted a reward. New **`getState(customerId)`** returns the canonical
reward-aware `CustomerState` (settled balance + unspent-reward list) straight from the store. New
**`undo(actor, idempotencyKey)`** wraps `undoCommit` (reverse net points, void fresh mint, re-mint
a point-neutral replacement per spent reward — a spent reward is never un-spent) and writes a
`loyalty.reverse` audit row for the acting staff; it sends no email (a reissue is not a fresh
crossing). **`getStats`** now derives `rewardsRedeemed` from the `loyalty.redeem` audit rows (the
surfaced `reward.redeemed` events), **not** the ledger — which no longer carries `redemption` rows;
`pointsIssued` still sums `accrual` entries. `domain/insights.ts` unchanged in logic (its `rewards`
metric already counts `loyalty.redeem`) — comment clarified that each row now corresponds to a
reward redemption. Phase 3 is ADDITIVE: the transitional `accrue`/`redeem`/`reverse` methods and
`getStateByToken`/`getStateById`/`getStateByShortCode` (old `rewardAvailable`/`progress`
derivation) stay until the Scan (Phase 5) and Card (Phase 6) UIs are reworked. **+8 tests**
(commit mint-on-cross, over_cap/customer_not_found short-circuit, idempotent retry, subset-redeem,
one-email-per-mint, getStats counts reward events, undo reissue + reverse audit) — **421 Vitest
tests**, tsc + build all green. Prior — **Rewards-as-objects — Phase 2 (storage adapter + schema v5 + new seed).** Core storage rework of the [`REWARDS-PLAN`](REWARDS-PLAN.md). IndexedDB bumped to **schema v5** via a clean reset (upgrade drops + recreates every store, then seed repopulates in the new model — no migration; prototype has no live data to preserve). Three new stores: **`rewards`** (materialized Reward projections; indexes byOwner/byToken/byStatus/byShortCode), **`rewardEvents`** (append-only reward lifecycle log = source of truth for status; byReward/byOwner), **`idempotencyKeys`** (commit dedup cache). `IndexedDbStore` implements four new port methods: **`commitCounterTransaction`** (single atomic readwrite tx over config/customers/transactions/rewards/rewardEvents/idempotencyKeys; idempotent on `idempotencyKey`; short-circuits `over_cap`/`customer_not_found` with no writes; subset-redeem — stale/invalid reward id lands in `rejected[]` and never aborts; ownership re-validated at commit), **`listRewards`**, **`getCustomerState`** (settled balance 0..threshold−1 + unspent-reward list/count), and **`undoCommit`** (5s-undo: reverse net points, void freshly-minted unspent rewards, re-mint a point-neutral replacement per reward the commit spent — a spent reward is never un-spent; itself idempotent). Audit is NOT written inside the commit — the service layer appends it in Phase 3, matching today's pattern. `demoSeed` rewritten to the reward model (discrete unspent/spent Reward objects + reward_issue ledger entries + reward events; balances settle; still emits `loyalty.accrue`/`loyalty.redeem` audit rows so transitional audit-based admin stats keep content until Phase 3). Phase 2 is otherwise ADDITIVE: the transitional `redemption` TransactionType, public `redeemReward`, and `rewardAvailable`/`progress` derivations stay (Phase 3/5/6 still use them). **+18 tests** (13 store commit/undo tests + 5 demoSeed coherence tests) — **413 Vitest tests**, tsc + build all green. Prior — **Rewards-as-objects — Phase 1 (pure domain + tests).** Second step of the [`REWARDS-PLAN`](REWARDS-PLAN.md) rework — **pure logic only, nothing wired** (the storage rework is Phase 2). New **`src/domain/rewards.ts`** holds the rewards-as-objects derivation/decision rules, all total + side-effect-free: `unspentRewards` (the "N free" count that replaces the `rewardAvailable` boolean), `cardProgress` (settled stamp-grid progress `{current, threshold}` — **drops** `rewardsAvailable`), `mintFold` (the mint-on-cross fold → `{mintCount, threshold, perMintPoints: −threshold, settledBalance}`, folds a multi-reward crossing in one step), `validateRedemption` (per-reward commit-time re-validation → `not_owner` / `already_spent` / `reward_invalid`, ownership beats status, for subset-redeem), `isOverCap` (the `over_cap` server guard), and `planUndo` (the 5-second-undo decision → `reversePoints = mintedCount·threshold − pointsDelta`, void freshly-minted rewards, re-mint a replacement per spent reward — a spent reward is never un-spent). `domain/tokens.ts` gains `generateRewardToken`/`generateRewardShortCode` (reward identifiers reuse the customer token + Crockford-base32 machinery verbatim, §3.6). `domain/loyalty.ts` doc-note only: balance now **settles** to 0..threshold−1 once `reward_issue(−threshold)` entries are in the ledger; its old derivation stays transitional until Phase 3. **+29 tests** (`tests/domain/rewards.test.ts` covers mint-on-cross, multi-mint loop, validation matrix, cap, undo decision; `tokens.test.ts` extended) — **395 Vitest tests** + tsc + build all green. Prior — **Rewards-as-objects — Phase 0 (contracts & types).** First step of the [`REWARDS-PLAN`](REWARDS-PLAN.md) rework. Added the rewards-as-objects type vocabulary and the unified-commit port contract — **no behavior wired**. `domain/models.ts` gains `Reward` (materialized projection + status `unspent`/`spent`/`voided`/reserved `transfer_pending`), `RewardEvent` (append-only lifecycle = source of truth), `RewardStatus`/`RewardEventType`, `LoyaltyTransaction.rewardId?`, a new `reward_issue` `TransactionType` (with `redemption` kept **transitionally** so pre-rework code compiles — removed in Phase 2), and the canonical `CustomerState` read-model (defined in the domain so the `DataStore` port can reference it without a layer inversion; `LoyaltyService` now re-exports it). `ports/DataStore.ts` gains `CounterTransaction`, `CommitResult`/`RejectedRedemption`, and the `commitCounterTransaction`/`listRewards`/`getCustomerState`/`undoCommit` signatures (the old `redeemReward` stays transitional). `ApiStore` wires the four new methods to HTTP-call stubs; `IndexedDbStore` carries throwing Phase-0 placeholders for them (implemented in Phase 2). tsc + 370 tests + build all green; nothing calls the new paths yet. Prior — **Botanical redeem overlay.** The "Your free coffee" redeem overlay now frames the QR in the café's **botanical artwork** — forest leaves, espresso beans, a coffee-cherry cluster arranged as a wreath on a warm cream panel — replacing the dark forest panel + gold border + shimmer + star (copy unchanged). New shared presentational **`BotanicalWreath`** component (aria-hidden SVG Leaf/Bean/Cherries primitives), centre kept clear so the foliage never touches the code. +1 test. Prior — **Dot-style QR.** QR codes now render from the module matrix (`QRCode.create`) as an **SVG of dots**, with the three finder patterns kept as **rounded-square eyes** (scanners locate by them); replaces the square-module PNG. No new dependency; brand-ink on the light tiles for contrast; applies everywhere via `toDataUrl` (card QR, redeem overlay, device-pairing QR). Prior — **Multi-reward badge + tappable "redeem" QR.** When 2+ free coffees are unlocked, the card's unlocked banner shows a **cup-glyph count badge** on the right (1 reward → no badge; count = `progress.rewardsAvailable` = `floor(balance/threshold)`). The unlocked banner is now **tappable** → a special **redeem** presentation of the *same* QR: a forest panel with a **gold-trimmed, shimmering QR** (shine reuses the unlocked-banner sweep), gold star, "Your free coffee" / "Show this at the counter to redeem." (no wallet button). Tapping the QR tile still opens the plain enlarged view; `EnlargedQr` gained a `redeem` flag and `Card` tracks which mode opened it. `LoyaltyCard` gained `rewardsAvailable` + `onRedeem`. +1 test. Prior — **Wedged-IndexedDB self-heal + floating Find-us card + Reset rework.** Root cause of "card creation / login stuck 20s+, dev panel shows no DB data, Reset does nothing": every DB call awaits one `open()` promise, and after `DB_VERSION` → 4 a device with the site still open in another context (background tab / home-screen PWA holding the old-version connection) gets its v4 upgrade **blocked** with no handler and no watchdog → `open()` hangs forever. Fix: `open()` now has a **watchdog** (a blocked/stalled open rejects instead of hanging) and **auto-heals** by deleting the disposable DB and reopening fresh; added `blocked`/`blocking`/`terminated` handlers (blocking closes our connection so we never deadlock another context); `deleteDatabase` is time-bounded too. `PairingContext.reset()` races the graceful wipe against a watchdog and **hard-resets** (delete DB + reload) if the store is wedged. **Tests** (the gap that let it through): added a real **v3 → v4 migration** test and a **self-heal** test (open against an incompatible higher-version DB must delete + reopen, not hang); prior tests only simulated a legacy row via `importAll`, never a cross-version open. The dev-panel storage diagnostic now **times out → "unavailable — store not responding"** instead of rendering nothing. UI: the **"Find us" section is a floating cream card** (24px radius = loyalty card) on a **solid** section colour (`bg-forest`/`bg-sage`/`bg-blush` are now solid) that runs behind it — no gradient handoff. **Reset is a single self-arming button**: tap arms it (danger), it decays back to normal over 3s and auto-disarms; closing the panel cancels it. Prior — **Reverted the continuity-scroll / toolbar-tint / seam-gradient direction entirely** — it never worked: the hero→Find-us handoff can't know the upper section's true edge colour so the fade was never clean, and the translucent iOS toolbar still showed the next section even without scrolling. Deleted `useContinuityTheme`; `FindUs` is a plain prop-less component again (no `from`/`.findus-fade`); Welcome/Card dropped the continuity wiring and the hero/card-main gradient anchoring; `base.css` `bg-forest` is back to the original `170deg`. The static `index.html` `<meta theme-color="#2E4A3A">` is the original and stays. Kept the unrelated work that landed alongside it (Crockford short-code card display, warm-camera revert). Prior — Regression fixes for the short-code/schema-v4 change: the v4 **backfill moved OUT of the `versionchange` upgrade** (awaiting a cursor loop there can hang the upgrade transaction on Safari → every DB op then blocks: blank/stuck card, stuck card-creation). The upgrade now only creates the `byShortCode` index; a **safe post-open `backfillShortCodes`** (normal transaction) assigns codes to legacy customers and self-heals partially-migrated devices. `formatShortCode` is **null-safe** (no more crash on a not-yet-backfilled card) and `allocateShortCode` tolerates a missing index. The dev-panel **Reset uses an in-app two-step confirm** instead of `window.confirm` (suppressed in iOS standalone — that's why Reset "didn't ask"). Prior — Short code + continuity scroll + warm camera: a **Crockford base32 short code** (8 chars, no I/L/O/U) is now a human-shareable, camera-fail card handle — the token stays the identity; shown on the card (`CKY · K39X-Q4T7`) and accepted by the **restored scan manual entry** (`getStateByShortCode`; store `byShortCode` index, schema v4 + backfill). **Continuity-scroll colour handoff** (`useContinuityTheme` drives `<meta theme-color>` + a FindUs gradient lead-in) stops iOS Safari's translucent toolbar showing a sliver of the next section. The **scan camera is kept warm** (acquired once per visit, pause/resume between customers in `qr/scan.ts`) so iOS doesn't re-prompt for permission every scan. Prior — Recovery/scan simplification: **staff registration removed** (redundant with self-registration — the scan "card not registered" state now tells staff to have the customer join on their phone; the `provisionFromToken` UI path is gone); **recovery is email-only** (staff/name-based recovery dropped — a name isn't distinguishing enough; `LostCard` lost its staff-fallback banner and now explains the no-email consequence); and the **manual code-entry fallback in the scan view is removed** (the ~20-char token is unrealistic to read aloud). Open question logged for a short, shareable recovery code (camera-fail vector). Prior — Trends: the **"Active members" tile was renamed "New members"** (its trend = registrations), and a **new "Active members" tile** added that counts **unique active customer cards** (any loyalty activity). Its trend popover splits the same today/week/month/all-time, but counts **unique cards** per bucket — today (2-hourly), week (per day), **month (per week)**, all time (per month) — via a unique-count + weekly-month mode in `domain/insights.ts`. The headline is today's unique active cards. +2 tests. Prior — Admin layout: **"Needs a look" moved above "This week"** and **hidden entirely when nothing needs review** (no flags / all acknowledged); its label/badge/chevron now sit on one centred row (the chevron is a rotating SVG, spacing moved off `.section-h`). The two program settings (**reward threshold**, **max coffees per scan**) moved out of the stats grid into a **"Configure program"** popover (extensible — more fields later); a row's "Change" still opens the value+PIN `ProgramEdit` sheet on top. Prior — Counter/admin header symmetry + counter "today" list: the **role badge moved next to the logo** on both headers — counter `TopBar` shows `[logo · Counter/Admin]` on the left with the **"Go to admin"** button now in the bar's right slot (admins); the admin head gained a matching **"Admin" badge** beside the logo with **"Go to counter"** on the right. The counter's recent list is now **"Today on this terminal"** — **today-only**, **collapsible**, showing **5 rows then "Load more"/"Load all"** via the shared `usePager` (moved to `ui/common/usePager.ts`). Prior — Admin/counter batch 2: **counter-first routing + pageable lists + acknowledgeable alerts**. Both staff *and admins* now land on the **counter** on login (`EntryResolver`/`Login`/logo gesture); the counter shows a top **"Go to admin"** button for admins (the bottom "Back to admin panel" is gone), mirroring admin's "Go to counter" (now top-left). **"Needs a look"** is **collapsed by default with a red count badge**, its entries are **tappable** → an **`AlertDetail`** popover (staff who triggered it · warning type · exact time · the customer card it acted on) with **Acknowledge & dismiss** (persisted via `config.dismissedAlerts` + `alertKey`, filtered out of `getAlerts`). The **Flagged actions** stat tile was removed (its count is the badge). **Activity**, **Needs a look**, and the **StatDetail** entry lists are now **pageable** — "Load more", and after the 3rd tap a "Load all" shortcut (shared `usePager`). +6 tests. Prior — Admin batch: **expandable stat breakdowns + config-edit fix + demo seed**. The program-config edits (reward threshold, max coffees per scan) no longer use `window.prompt` (mobile Safari suppressed it → "enter PIN, nothing happens"); a new in-app **`ProgramEdit`** sheet collects the value + PIN. The three headline tiles (**Active members / Coffees today / Rewards redeemed**) are now **tappable** → a **`StatDetail`** popover with a **today/week/month/all-time** selector, a bar chart, and the matching activity list, all derived purely from the audit log via **`domain/insights.ts`** (unit-tested). **Go to counter** moved to the **top** of the admin screen. The DB now **seeds demo members/ledger/audit across ranges** on a fresh/Reset device (`adapters/storage/demoSeed.ts`, gated by `new IndexedDbStore({ seedDemo: true })` in the composition root — off in tests), plus a **third seed staff** account (`priya`, PIN `2468`). +5 tests. Prior — Reset root-cause fix: `IndexedDbStore.reset()` no longer calls `deleteDatabase` (which can hang silently in Safari — no event ever fires — leaving the store on a dead connection until a reload: the real "after reset, dev panel empty + card creation fails until reload" bug). It now **empties every object store on the live connection and re-seeds**, so the store is usable the instant reset resolves; `PairingContext.reset()` clears storage first, then awaits the (now hang-proof) wipe, then re-resolves. Prior — Reset fix + Find-us/QR polish: **Reset now clears the device-visible state (storage + re-resolve) BEFORE the IndexedDB wipe** in `PairingContext.reset()` — Safari can hang `deleteDatabase`, which previously left the recognition token behind on a host/unpaired reset; the data wipe is now best-effort + time-bounded. Added a **prototype storage diagnostic** to `ProtoPanel` (display mode, recognition·localStorage, card-data·IndexedDB count, pairing snapshot) so a tester can reload — esp. iOS home-screen — and see exactly what survived. Find-us map now **loads eagerly** (`loading="eager"`) so a scroll shows it ready; the **Contact us** block is **left-aligned with style-matched line icons** (envelope + Instagram) instead of text labels. The enlarged card QR is now wrapped in a **cream, round-cornered box** (matching the card's QR tile) on the white overlay. Note: iOS home-screen `localStorage` durability is still under investigation (see Known gaps). Prior — Find-us map aesthetic: the embedded map now uses a **roadmap base** (dropped the `t=k` satellite layer in `config/cafe.ts`) **warmed toward the cream/sage palette** with a gentle CSS `filter` on `.findus-map` and a **card-style frame** (sage border + soft forest shadow) — no Google Maps API key (true tile recolouring would need one; the iframe is cross-origin). Prior — Pairing/reset rework: **role-aware, reload-free Reset** + a **reversible pairing overlay**. `IndexedDbStore.reset()` now deletes **and re-opens + re-seeds the DB in place** so the live store stays usable (fixes "create a card fails until a hard refresh"); `PairingContext.reset()` branches — host/unpaired fully wipes (DB + all storage), a paired client clears only its own storage (keeping data on the till) — and both **re-resolve via `navigate('/')`, no page reload**. Pairing is now a push/pop overlay (`ui/common/storageSnapshot.ts`): join **snapshots** the device's storage into one reserved key + starts fresh; unpair (voluntary or host-forced) **restores** it; a leftover snapshot at boot self-heals in `main.tsx`. **No device is auto-routed to staff** on pairing (every joiner → `/welcome`); a client exposes the till's id (`joinedHostId`) so the dev panel shows the **host's QR** (grow the network from any device); a host reset forces unpair + a **"till disconnected" toast** on clients. +8 tests (`storageSnapshot`, `IndexedDbStore.reset`). Prior — Docs-only: recorded the **storage / device-recognition** model and the **prototype→production switch checklist** as known debt — IndexedDB (the DB) vs localStorage (token/session flags) vs cookies (none); no JS-cookie durability win on iOS (only a server-set HttpOnly cookie survives ITP, needs a backend) so localStorage is kept deliberately; the device-pairing layer is host/client (scanner becomes client; one host, many RPC clients) and is wired through `services.sync` + `PairingProvider` + `dataVersion` screen refs + `/pair`, so switching out is not a single adapter swap — decision: leave as-is until server testing. Details in divergence d + Known gaps. Prior — Email + QR polish: the Register email field gets **inline format validation** (`isValidEmail`; submit disabled until valid); registering with an email now sends a best-effort **"card created" welcome email** (new `card-created` `MailKind`; `CustomerService` gained an optional `Mailer`). Café contact is `ckykacafe@gmail.com`; the **Instagram** button links to `ckykacoffeeshop` (universal link opens the app on mobile). The card **QR tile** dropped the in-tile "tap to enlarge" label and is now a compact cream box sized to the QR (centred, small offset); the enlarge/wallet hint stays below the card. Placeholders: name "Your name", email "Your email address" (register + restore). Prior: Find us + dev-scan polish: the **Find us** section (now a shared `FindUs` component on both Welcome and the card page) sits **below the fold** — each page is one full screen with a "scroll for hours & location" hint, then Find us; Find us gained an **embedded map** centred on the café (keyless `output=embed`) with **Get directions** beneath it and an **Instagram** button beside Contact us (`config/cafe.ts` `cafeMapEmbedUrl`/`cafeInstagramUrl`); the dev-panel **Scan to pair** now pairs **in place** without redirecting (`PairingContext.joinAs(id, { redirect: false })`) so the camera modal isn't yanked away on a successful scan. Prior: Card-menu confirmations + fixed 10-stamp card: the card "⋯" menu now redraws into red-tinted **remove/delete confirmations** with recovery-aware copy and a `HoldButton` (3-second hold, expanding red fill, selection disabled) for unrecoverable actions; single-tap remove for recoverable cards. The loyalty card is a **fixed 10-stamp grid** — welcome + 8 purchases + FREE, with the first and last **pre-stamped**; IndexedDB **upgrade v3** migrates devices still on the legacy 10-coffee threshold down to 8. Prior: Admin/loyalty/popover batch: reward threshold default **8** (card still shows a **10-cup showcase** — welcome sticker + 8 earnable + FREE reward cup; "Gold" badge removed); admin is now a **superset of staff** (counter/scan access + admin view, both with **Sign out**); admin **account management** popover per profile — enable/disable, reset password, reset PIN, **delete** (`StaffService.remove`/`DataStore.deleteStaff`), + that profile's activity history, un-gated; **Add profile** makes staff or admin; popovers lock background scroll, are **drag-to-dismiss** + self-scrolling; dev-panel **Scan to pair** opens an in-window camera modal; card-menu rows are two-line; the recognized-customer card page now has the shared **Find us** below-the-fold section; `Toggle` restyled to a themed pill; login username placeholder "staff". Prior: Auth + dev-panel UX revision: staff/admin sign-in is now **username/password first** with the PIN reserved for quick re-auth on a remembered idle device; staff accounts gained a **display name** (name/username/password/PIN) and admins create accounts from the panel; logo **tap → home** is role-aware (admin→/admin) and long-press → sign-in; the Prototype/developer panel moved to a **hidden top-left `DevTrigger`** and was stripped to **QR / Scan to pair / Reset**; register privacy notice is a tappable accented link opening a sheet; centred Welcome logo; "Add to wallet" pop-up-blocker fix. **Follow-ups:** signed-in logo gestures (tap **and** long-press) go to the role home, not the sign-in page — an *active* (even non-remembered) session routes to its panel via `EntryResolver`; bottom **`Sheet`s are drag-to-dismiss** (pull the grab handle down) and scroll tall content; the dev-panel QR sizing fixed (the shared `.qr` class was clamping it to 84px); viewport set to `maximum-scale=1, user-scalable=no` + 16px form inputs so pages never zoom on focus/navigation) · **Phase:** v1 prototype — feature-complete against SPEC §15 (Appendix A implemented) + Appendix B partially implemented (B1–B3, B6 partial via Welcome, B7 documented; B4 and B5 dropped, B6 remainder deferred).

---

## At a glance

- React + TypeScript + Vite SPA, IndexedDB storage — the IndexedDB adapter and the prototype
  transport/wallet/pairing seams are being retired (see the box at the top of this file); the
  GitHub Pages deploy went with them in Phase 6.
- **Three-package npm-workspaces monorepo** (root `package.json` `workspaces: ["packages/*"]`,
  no SPA dependencies or `vite`/`vitest` scripts of its own — it delegates via
  `npm run build|test|typecheck --workspaces` and `npm run dev -w @cafe/web`). The physical move
  (BACKEND-PLAN Phase 10) is **done**.
- **`@cafe/shared`** (`packages/shared/`) — the pure contract: `packages/shared/src/domain/` +
  `packages/shared/src/ports/`, tests at `packages/shared/tests/`. Resolved as a **real package**
  through its own `package.json` `exports` map (`@cafe/shared/domain/<name>`,
  `@cafe/shared/ports/<name>`) — not a path alias. Checked by a single strict compiler
  (`packages/shared/tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `NodeNext`, no ambient `@types/*`), which retires the two-compilers mismatch Phase 4 worked
  around (the SPA used to check `domain/`/`ports/` loosely, the server strictly, through the alias).
- **`@cafe/server`** (`packages/server/`) — the production backend: Fastify 5, PostgreSQL via `pg`,
  argon2id, hand-written numbered SQL migrations, no ORM. Phases 0–6 done — **`PostgresStore`
  implements the full `DataStore` port**, every `ApiStore` path has a route behind it on three
  authorization tiers, and the server now **emits and runs on plain `node`** (`dist/`, built by
  `packages/server/tsconfig.build.json`) rather than `tsx` outside `dev`; see
  [`BACKEND-PLAN.md`](BACKEND-PLAN.md).
- **`@cafe/web`** (`packages/web/`) — the React SPA, same code as before Phase 10 at its new home:
  `packages/web/src/` (`App.tsx`, `main.tsx`, `adapters/`, `config/`, `qr/`, `services/`, `ui/`),
  `packages/web/tests/`, `packages/web/e2e/`, plus `index.html`, `public/`, the Vite/Vitest/
  tsconfig files and `.env.example`. Composition root is
  [`packages/web/src/services/Services.ts`](../packages/web/src/services/Services.ts).
- **The `DataStore` conformance suite now lives beside the one store it specifies.**
  `packages/server/src/testing/dataStoreConformance.ts` (moved from `tests/conformance/` in
  Phase 10) is exercised by `PostgresStore.test.ts` — its only consumer since Phase 6 deleted
  `IndexedDbStore`, the suite's former second adapter; the `@cafe/conformance` alias is gone.
- **`@cafe/web` is red on purpose** (Phase 6; the counts below moved in Phase 10 without any new
  failure): **9 of 47 test files fail to load, 38 pass (189 tests)**; every `tsc` error is a Phase 6
  deletion. **`@cafe/shared` is green independently — 73 tests** (the six domain suites, moved out
  of the SPA's run in Phase 10). **`@cafe/server`: 390 tests** pass, `tsc` green, `dist/` emits and
  runs on plain `node`, all against a **real** Postgres at `TEST_DATABASE_URL` (default
  `postgres://cafe:cafe@localhost:5432/cafe_loyalty_test`; the run **aborts** in `globalSetup` if
  none is reachable — **a skip is not a pass**, and CI wiring is Phase 9). The release gate is
  `@cafe/shared` + `@cafe/server`; a red `@cafe/web` is expected until the UI pass.
- **Puppeteer e2e suite** (`packages/web/e2e/`, run with `npm run e2e`) drives the built app in
  headless Chrome: welcome, register→card, staff PIN, prototype panel, and the reference bug-list
  regressions (13 checks).
- CI: `.github/workflows/deploy.yml` tests → builds (injecting `VITE_EMAILJS_*`,
  `VITE_TURN_*`, and `VITE_GOOGLE_PLACE_ID` secrets) → deploys on push to `main`.
- Five swappable seams: `DataStore`, `Transport`, `Mailer`, `IdentityStore`, `WalletProvider`.
- Prototype device-pairing layer in `adapters/sync/` — deleted in Phase 6; production coordinates state on the server.
- UI rebuilt to Ckyka reference design: `packages/web/src/ui/theme/` (token slices),
  `packages/web/src/ui/components/<Name>/` (folder-per-component),
  `packages/web/src/ui/screens/<area>/<Screen>/` (folder-per-screen),
  `packages/web/src/ui/app/` (AuthContext, EntryResolver, routes, LogoGestures),
  `packages/web/src/ui/common/` (logic contexts).

## Acceptance criteria (SPEC §15)

| Criterion | State | Where |
|---|---|---|
| Staff/admin login + role gating | ✅ | `services/StaffService.ts`, `ui/app/AuthContext.tsx`, `ui/screens/staff/Login/Login.tsx` — **username/password first** (seed: admin `admin`/`admin`, staff `staff`/`staff`); **PIN** (seed admin `4321`, staff `1234`, plus a third staff `priya`/`2468`) is the quick re-auth on a remembered idle device (`ui/screens/staff/Unlock/Unlock.tsx`); both roles land on the **counter** (`/staff`), admins open `/admin` from there; staff guard via `useStaffGuard` inside screens |
| Self-service registration (primary path); no approval queue | ✅ | `ui/screens/customer/Register/Register.tsx`, `CustomerService.selfRegister`, `adapters/identity/LocalStorageIdentityStore.ts` |
| Staff-initiated registration | ❌ **removed** — redundant with self-registration. Staff scanning an unregistered code now shows "ask the customer to join on their phone first" (no card-create button). `CustomerService.provisionFromToken` still exists service-side but is no longer wired in the UI |
| No single-browser / dual-pane simulation | ✅ (LocalBridgeTransport removed) | `adapters/transport/` |
| Optional-PII and token-only registration | ✅ | `services/CustomerService.ts`, `domain/validation.ts` |
| Auto-provision on scan (unknown valid token → token-only card) | ❌ **removed from UI** (see above) — members are created only by self-registration |
| Accrual respects cap; append-only ledger; derived balance | ✅ now via the **unified commit** (rewards-as-objects rework) — one atomic `commit` accrues, mints rewards on threshold-crossing, and redeems N, capped at `maxPointsPerTransaction` (`over_cap` reject). Balance settles to `0..threshold−1`; the "N free" count = unspent `Reward` objects (not a derived boolean). See the **Rewards-as-objects acceptance (C9/D10)** table + formats subsection below. | `services/LoyaltyService.ts` (`commit`), `adapters/storage/IndexedDbStore.ts` (`commitCounterTransaction`), `domain/loyalty.ts` + `domain/rewards.ts` |
| Reward-available email on threshold crossing (best-effort) | ✅ | `LoyaltyService.commit` → `Mailer` (exactly one email per commit, only when the commit minted ≥1 reward) |
| Atomic redemption (no double-spend) | ✅ now a **commit-time, idempotent, subset redeem** — every `redeemRewardId` is re-validated (`not_owner`/`already_spent`/`reward_invalid` → `rejected[]`, valid ones still redeem); a 2nd commit with the same `idempotencyKey` returns the cached result with no writes (prototype atomicity = single IDB-tx scope; the production store adds a real `SELECT … FOR UPDATE` row lock — see divergence **l**) | `adapters/storage/IndexedDbStore.ts` and `packages/server/src/PostgresStore.ts` (`commitCounterTransaction`), held to one shared contract by `tests/conformance/dataStoreConformance.ts` |
| Self-service recovery via single-use expiring link (EmailJS) | ✅ impl; needs live verification | `services/RecoveryService.ts`, `ui/screens/customer/LostCard/LostCard.tsx`, `ui/screens/customer/RecoverConsume/RecoverConsume.tsx`, `adapters/email/EmailJsMailer.ts` |
| Recovery is **email-only** | ✅ | `ui/screens/customer/LostCard/LostCard.tsx` — the single recovery vector is the emailed single-use link (`RecoveryService`). Staff/name-based recovery removed (a name isn't distinguishing enough). LostCard now explains the **no-email consequence** (a card with no email can't be recovered); the registration caveat (`Register.tsx`) says the same up front |
| Correction/reversal, logged | ✅ | `LoyaltyService.reverse` writes an offsetting `reversal` entry + `loyalty.reverse` audit row — the SPEC §6 correction primitive. The rewards-as-objects **post-commit undo** (`LoyaltyService.undo`/`DataStore.undoCommit`) is **retired** (Appendix E, Phase 1): the staff Scan now defers every write behind a **3-second pre-commit hold** instead, so a wrong transaction is cancelled before it's ever written rather than reversed after — see the Staff integrity & observability acceptance (E9) table below |
| Deletion/opt-out — customer self-delete from card menu; staff-confirmed also available | ✅ | `CustomerService.selfDelete(token)` ← `ui/screens/customer/CardMenu/CardMenu.tsx`; `IndexedDbStore.softDeleteCustomer` |
| Admin: account CRUD (**Add profile** staff/admin with name/username/password/PIN; per-profile popover = enable/disable, reset password, reset PIN, **delete** — un-gated) + "Sign out all devices"; config (step-up PIN re-auth on save), stats, audit viewer, alerts, activity export; admin is a **superset of staff** (counter/scan access, both views have Sign out) | ✅ | `ui/screens/admin/Admin/Admin.tsx`, `ui/screens/admin/_parts/AccountSheet/`; `StaffService.remove` → `DataStore.deleteStaff`; staff `name` shown in panel + activity. Per-profile activity history moved out of `AccountSheet` — reachable only via the audited Export workflow (Appendix E, Phase 3/4) |
| Staff/admin session never auto-displays customer card (entry routing) | ✅ | `ui/app/EntryResolver.tsx` — any active staff/admin (trusted or ephemeral)→**counter** `/staff` (admins reach `/admin` via the counter's "Go to admin" button); trusted+locked→`/staff/unlock`; remembered card→`/card/:token`; else→`/welcome` |
| Inactivity lock (5 min) → PIN re-auth at `/staff/unlock` | ✅ | `ui/app/AuthContext.tsx`, `ui/screens/staff/Unlock/Unlock.tsx`, `StaffService.loginWithPin` |
| Epoch-based "Sign out all devices" revocation | ✅ | `StaffService.revokeAllSessions`, `ProgramConfig.sessionEpoch` |
| Suspicious-activity alerts — monitoring only | ✅ pruned to **two** attributed detectors (Appendix E, Phase 2): **self-dealing proximity** (same staff accrues then redeems on the same card within a window, repeatedly) and **repeat-target** (same customer credited repeatedly in a window); thresholds are admin-configurable; no role exemption | `domain/alerts.ts`, `LoyaltyService.getAlerts()`, `ui/screens/admin/_parts/Alert/Alert.tsx`, `ui/screens/admin/Admin/Admin.tsx` (Configure → "Activity alerts") |
| WalletProvider seam; OS-detected wallet button inside enlarged-QR overlay; links to walletwallet.dev pre-generated passes | ✅ | `ports/WalletProvider.ts`, `adapters/wallet/StaticWalletProvider.ts`, `ui/screens/customer/EnlargedQr/EnlargedQr.tsx`, `wallet/passes.ts` |
| Storage behind `DataStore`; Transport behind `Transport`; Email behind `Mailer`; Identity behind `IdentityStore`; Wallet behind `WalletProvider` — swap = no UI/service change | ✅ | `ports/`, `adapters/`, `services/Services.ts` |
| Two-device demo over PeerJS + TURN (real cross-device, not simulated) | ✅ impl; cellular verification = manual live-demo step | `adapters/transport/PeerTransport.ts`, `config/env.ts` |
| Device pairing — one till hosts many customers; live DataStore sync across all devices | ✅ prototype-only (see divergences e, f) | `adapters/sync/`, `ui/common/PairingContext.tsx`, `ui/common/PairDevices.tsx` — all devices host by default; scanning a till's QR makes the scanning device a customer (**no device is auto-routed to staff** — every joiner lands on `/welcome`); a paired client also exposes the till's id (`joinedHostId`) so it can show the **host's QR** and the network can grow from any device; pairing is a reversible overlay — join **snapshots** the device's storage and starts fresh, unpair (voluntary **or** host-forced, with a "till disconnected" toast) **restores** it; unpair signals all peers and each resumes hosting |
| Domain unit-tested; file tree matches SPEC §12 | ✅ (new UI layout diverges from SPEC §12 — see divergences g, k) | `packages/shared/tests/`, `packages/web/tests/`, domain + services match |
| Adapters/transports/services unit-tested (regression cover) | ✅ | `packages/web/tests/adapters/*`, `packages/web/tests/services/*`, `packages/web/tests/qr/*`, `packages/shared/tests/alerts.test.ts` |
| Co-located component/screen tests (Vitest, jsdom) | ✅ | `packages/web/src/ui/components/**/*.test.tsx`, `packages/web/src/ui/screens/**/*.test.tsx` — included via `vite.config.ts` `test.include` |
| Browser-level end-to-end smoke | ✅ impl (manual) | `packages/web/e2e/*.e2e.ts` (Puppeteer, headless Chrome) via `npm run e2e` — 13 checks across welcome/card/staff/prototype/regression |
| **B1** Device persistence — remember/forget exactly one card; no auto-save on view; registration toggle | ✅ | `ui/screens/customer/Card/Card.tsx`, `ui/screens/customer/Register/Register.tsx` |
| **B2** Card QR encodes card-page URL; `tokenFromCardScan()` extracts token; bare tokens still accepted | ✅ | `qr/encode.ts` (`cardPayload`, `tokenFromCardScan`), `ui/screens/staff/Scan/Scan.tsx` |
| **B3** Recovery-tier disclosure at signup | ✅ | `ui/screens/customer/Register/Register.tsx` |
| **B4** Post-first-redemption review prompt; dismissible; once per device; deep-links Google write-review; no sentiment gating | ❌ dropped in the Ckyka rebuild (not in the new UI spec); the old `ReviewPrompt` was removed with the old screens — re-add if wanted | was: `ui/customer/ReviewPrompt.tsx` |
| **B5** Own-card photo | ❌ explicitly dropped (out of scope per requester) | — |
| **B6** Footer / Find us | ✅ partial — "Find us" (location/hours) on Welcome screen below the fold; café details in `config/cafe.ts`. Light/dark mode, progressive card animations, menu page intentionally not built. | `ui/screens/customer/Welcome.tsx`, `config/cafe.ts` |
| **B7** Family/couples sharing | No feature code needed — expected behaviour. Sharing the card URL/QR shows the card on any device without overwriting the saved card. Future changes must not bind a card to exactly one device. | documented only |

## Rewards-as-objects acceptance (C9 / D10)

The rewards-as-objects rework (Appendices C + D + multi-reward, plan in
[`REWARDS-PLAN.md`](REWARDS-PLAN.md), decisions in
[`REWARDS-DECISIONS.md`](REWARDS-DECISIONS.md)) reworked rewards from an implicit
`balance ≥ threshold` boolean into discrete, countable `Reward` objects, a single
atomic/idempotent commit, and customer-driven multi-reward composite redemption. It
**supersedes** SPEC §6 (reward derivation) and §8.2/§8.3 (scan/commit) and refines B2 —
`docs/SPEC.md` is authoritative and unedited, so these are recorded here as divergences.
All acceptance criteria below are met and test-covered:

| Criterion (REWARDS-PLAN §5) | State | Test / where |
|---|---|---|
| Crossing threshold mints exactly one reward per `pointsPerReward`, same commit | ✅ | `domain/rewards.ts` `mintFold` — `packages/shared/tests/rewards.test.ts`; the commit's mint-on-cross now lives in `packages/server/src/PostgresStore.test.ts` + the conformance suite (the prototype `IndexedDbStore` and `LoyaltyService` suites that covered it are deleted/red — Phase 6) |
| Retried commit (same key) neither double-accrues nor double-mints | ✅ | `idempotency_keys` dedup — commit twice same key → identical result (now `replayed: true`), one write set. `packages/server/src/PostgresStore.test.ts` + conformance; the prototype's store and sync round-trip tests are deleted (Phase 6) |
| `balance` settles `0..threshold−1`; "N free" = unspent reward count | ✅ | `domain/rewards.ts` `cardProgress`/`unspentRewards`; `getCustomerState` — derivation tests |
| Redeem atomic + idempotent; 2nd → `already_spent`; non-owner → `not_owner` | ✅ | `domain/rewards.ts` `validateRedemption` (ownership beats status); `commitCounterTransaction` subset-redeem — domain + store tests |
| Reversing a minting accrual voids the minted reward | 🗑️ **retired** (Appendix E, Phase 1) | The post-commit undo this depended on (`planUndo`/`undoCommit`) is deleted — see below |
| Reward log append-only; status only via events | ✅ | `rewardEvents` store = source of truth (`reward.issued`/`reward.redeemed`/`reward.voided`); `rewards` is a materialized projection — store-invariant tests |
| One commit can add points AND redeem ≥1; never gated by QR type | ✅ | `CounterTransaction { pointsDelta, redeemRewardIds[] }`; staff Scan slider `min=0` + reward checklist, one `commit` — `ui/screens/staff/Scan` tests |
| Source tag (`'a'`/`'w'`) parsed + recorded; drives nothing but validation/analytics | ✅ | `parseScan` (`qr/encode.ts`); `commit` writes `source` on the audit row only — parse + Loyalty audit tests |
| No per-transaction freshness anywhere | ✅ | by design — no timestamp validation on any path |
| Every `redeemRewardId` re-validated at commit; subset redeemed, rest reported | ✅ | stale id in set → `rejected[]`, valid ones still redeem (commit never aborts) — the conformance suite, now at `packages/server/src/testing/dataStoreConformance.ts` |
| Wallet scan with rewards surfaces the redeem affordance from the list | ✅ | a baked wallet pass embeds the **card** URL (`…/#/c/<token>?s=w`); a wallet scan resolves as a plain card scan and staff Scan shows the unspent-reward checklist — Phase 7 (Scan tests). A wallet pass never carries a composite reward QR |
| All three input paths return `{ customer, balance, rewards }` | ✅ | card scan (`/c`), reward scan (`/r`), manual short-code all resolve to the canonical `CustomerState` via `getState` — Scan + service tests |
| Undo within 5s: points reversed, fresh mint voided, spent re-minted | 🗑️ **retired, replaced** (Appendix E, Phase 0/1) | The 5-second **post-commit** undo is replaced by a 3-second **pre-commit** hold — nothing is written until the customer's transaction is confirmed, so there is nothing to reverse/void/re-mint after the fact. See the **Staff integrity & observability acceptance (E9)** table below |

### Rewards-as-objects: formats

**Ledger / reward stores (schema v5).** The points ledger
`TransactionType` is `accrual | reward_issue | reversal` — `redemption` is **removed**
from the ledger. Reward lifecycle lives in two new stores: `rewards` (materialized
`Reward` projection — `byOwner`/`byToken`/`byStatus`/`byShortCode`; status
`unspent | spent | voided`, reserved `transfer_pending`) and `rewardEvents` (append-only
`reward.issued | reward.redeemed | reward.voided` — **source of truth** for status). A
third store `idempotencyKeys` caches each `CommitResult` by `idempotencyKey`.

**Reward token + short code** (`domain/tokens.ts`): a reward carries a 128-bit opaque
**token** (`generateRewardToken`, goes in the reward QR) and a Crockford-base32
**short code** (`generateRewardShortCode`, `byRewardShortCode` index) used **only** on the
manual / camera-fail path — never in the QR. Reuses the customer token + short-code
machinery verbatim (§3.6).

**Scan QR-URL formats** (`qr/encode.ts`; `parseScan` returns
`{ kind:'card'|'reward', customerToken, rewardTokens[], source:'a'|'w' }`):

```
card    .../#/c/<customerToken>?s=a|w
reward  .../#/r?ids=<rewardToken[,rewardToken…]>&c=<customerToken>&s=a   // 1..10 ids (composite); cap 10, hard 15
wallet  baked pass embeds  .../#/c/<customerToken>?s=w                   // maintainer-provisions; resolves as a card scan
manual  customer short code → full state + unspent-rewards list to tick
```

`/c` and `/r` are **staff-scan URLs only** — deliberately *not* mounted as react-router
routes (`ui/app/routes.ts` `SCAN_PAYLOADS`). `parseScan` stays **backward-compatible**:
legacy `…/#/status/<token>` URLs and bare tokens resolve as a card scan (`source:'a'`), so
older baked wallet passes never hard-fail. Measured QR capacity (EC-M, full tokens): N=5 →
v9, N=10 → v12 (~65px, comfortably phone-to-phone scannable), N=15 → v15 — hence full ids +
cap 10; short codes are not needed in the QR.

**The commit** (`DataStore.commitCounterTransaction`, the single atomic mutation entry):
one IndexedDB `readwrite` tx over `config · customers · transactions · rewards ·
rewardEvents · idempotencyKeys · audit`. Order: read the idempotency key → if present
return the cached result with **no** writes; else short-circuit `over_cap`
(`pointsDelta > maxPointsPerTransaction`) / `customer_not_found` (no writes); else append the
`accrual`, run `mintFold` (emit `reward_issue(−threshold)` + a `Reward` per crossing),
re-validate and redeem each id (invalid → `rejected[]`, never abort), persist the
`CommitResult` under the key, commit. Atomicity is IDB-tx-scope only — see divergence **l**.

**Undo model — retired (Appendix E, Phase 1).** The 5-second **post-commit** undo
(`LoyaltyService.undo` → `DataStore.undoCommit(idempotencyKey)`, decided by `domain/rewards.ts`
`planUndo`: reverse net points, void a freshly-minted unspent reward, re-mint a point-neutral
replacement per spent reward) is **deleted** — no port method, service method, domain function, or
sync allow-list entry remains. It is replaced by a **3-second pre-commit hold** on the staff Scan
(nothing is written until the window elapses or staff taps "Commit now"; Cancel discards with no
write) — see the **Staff integrity & observability acceptance (E9)** table below.
`LoyaltyService.reverse` (the SPEC §6 correction primitive, for after-the-fact corrections) is
unaffected and still writes an offsetting `reversal` entry + `loyalty.reverse` audit row. The
`reward.voided` `RewardEventType` is kept (a production `reverse` could plausibly void a reward)
but currently has **no producer** in the prototype — see Known gaps.

## Staff integrity & observability acceptance (E9)

The staff integrity & observability rework (Appendix E, plan + locked decisions in
[`INTEGRITY-PLAN.md`](INTEGRITY-PLAN.md)) reshapes how staff/admin actions are *surfaced, reached,
and corrected*; collection (the ledger, the audit log) is unchanged. One line: **the system
remembers everything, judges almost nothing, and announces the little it judges.** It **supersedes**
SPEC §6's audit-log surfacing, the SPEC §8.7 staff-management/activity views, the prior suspicious-
activity-alerts acceptance row, and the rewards-as-objects **5-second post-commit undo** (retired
above). `docs/SPEC.md` is authoritative and unedited, so these are recorded here as divergences
(**m**–**o**). All acceptance criteria below are met and test-covered:

| Criterion (INTEGRITY-PLAN §5) | State | Test / where |
|---|---|---|
| Transaction is held 3s before any write; Cancel writes nothing | ✅ | staff Scan: cancel during the countdown → store unchanged; timeout/"Commit now" → exactly one commit — `ui/screens/staff/Scan` tests |
| Terminal returns to idle/scanner after each commit (fresh scan per customer) | ✅ | staff Scan: post-commit state = scanner, no persistent card link |
| No post-commit reversal path exists | ✅ | `undo`/`undoCommit`/`planUndo` removed repo-wide; `LoyaltyService.reverse` retained |
| Exactly two detectors, both attributed, admins included, surfaced-not-blocking | ✅ | `packages/shared/tests/alerts.test.ts`: only `self-dealing` + `repeat-target` fire; an admin actor is flagged like anyone; nothing blocks |
| Self-dealing fires on a real redemption (not the dead ledger type) | ✅ | detector runs over paired `loyalty.accrue`/`loyalty.redeem` audit events (`AttributedEvent`), not the retired `type==='redemption'` ledger match |
| Detector thresholds editable via admin Configure | ✅ | `ProgramConfig.selfDealWindowSec`/`selfDealCount`/`repeatWindowMin`/`repeatCount`; Configure panel "Activity alerts" group — `ConfigService`/Admin tests |
| Staff terminal shows only recent-and-local (≤10 / 1h, own actions), never full history, no Load-all | ✅ | staff Panel "Your last hour" — `actorId`-filtered, capped, no pager |
| Admin home = shop-level only; no ambient cross-account feed; no casual per-account history | ✅ | `Admin.tsx`, `StatDetail`, `AccountSheet` tests |
| Cross-account activity only via export: blank form, required reason, audited, accounts incl. admins | ✅ | `ui/screens/admin/_parts/Export` tests; `AuditService.exportActivity` writes an `audit.export` row |
| Export produces a JSON file; past exports listed + re-runnable | ✅ | Export view test — download + past-exports list + "Re-run:" prefix |
| All data retained (no retention window); balance derivation unaffected | ✅ by design | no pruning; ledger/audit unbounded |

### Pre-commit hold (replaces post-commit undo)

The staff counter (`ui/screens/staff/Scan/`) now **stages** a `CounterTransaction` instead of
committing immediately: submitting enters a **3-second blocking countdown** that summarizes exactly
what is about to be written — points to add, rewards to redeem, and the rewards the commit will
mint (previewed client-side via `domain/rewards.ts` `mintFold`, since nothing is committed yet) —
with **Cancel** and **Commit now**. Nothing touches the store until the window elapses or "Commit
now" is tapped; the `idempotencyKey` is allocated at **stage** time, so an early commit and the
timeout can never race into two writes. Cancel discards the staged transaction (no write, back to
the counter panel). On success the terminal **auto-advances to the scanner** so every customer
starts from a fresh scan; a rejected `over_cap` commit drops back to the counter panel with the
existing per-scan-limit error. This is **purely client-side UI** — no store or commit-contract
change, and no new "committed" persistent state.

### Detectors — self-dealing + repeat-target

`domain/alerts.ts` `AlertKind` is `'self-dealing' | 'repeat-target'` — velocity, oversized
multi-add, off-hours, and outlier-share are deleted (in a one-café shop they fired on ordinary
trading, not fraud). **Self-dealing** pairs attributed `loyalty.accrue`/`loyalty.redeem` audit rows
(assembled into an `AttributedEvent[]` by `LoyaltyService.getAlerts`) by the same staff on the same
card within `selfDealWindowSec`, flagging at `selfDealCount`+ occurrences — this replaced a detector
that matched the ledger's `type==='redemption'`, a type the rewards-as-objects rework stopped
writing, so the old detector had been silently firing on **nothing**; that's the bug this rebuild
fixes. **Repeat-target** is unchanged in shape (same staff, same card, `repeatCount`+ credits within
`repeatWindowMin`). All four thresholds live on `ProgramConfig` (defaults 30s/3, 30min/3), are
whitelisted by `ConfigService.sanitizeConfig` (each floored at 1 whole unit), and are editable in
the admin Configure panel's "Activity alerts" group, driven by a `PROGRAM_FIELDS` map. No role
exemption — an admin actor is flagged exactly like staff. Alerts still only surface; nothing blocks.

### Activity surfacing — bounded, not ambient

- **Staff terminal:** "Today on this terminal" → **"Your last hour"** — the audit query filters by
  `actorId` (a staffer never sees a colleague's work), trims to a trailing one-hour window, caps at
  10 rows, and drops the pager/"Load all" entirely (the bound *is* the safeguard).
- **Admin home:** the cross-account Activity feed is deleted. The all-audit read remains only as the
  aggregate behind the "active members today" stat tile.
- **`StatDetail`:** total + chart only — the attributed per-action `EntryList` is removed.
- **`AccountSheet`:** keeps enable/disable, reset password, reset PIN, delete; loses its per-profile
  activity-history list (moved to the export workflow below).

### Investigation & export

`AuditFilter` (`ports/DataStore.ts`) gained `actions`/`actorIds` (OR within a field, AND across
fields, unioned with the pre-existing singular `action`/`actorId`) and an inclusive `from`/`to`
range; `IndexedDbStore.listAudit` reads the range through the previously-unused `byTimestamp` index;
`ApiStore` carries the new query params. A new `audit.export` `AuditAction` marks the export itself
as an audited event. `AuditService.exportActivity(actor, filter, reason)` refuses an empty reason
(trimmed, capped at 300 chars, PII-free like every other `details` value), runs the query, and
writes an `audit.export` row (reason + filter + row count) before returning the rows. The admin
**Export** sheet (`ui/screens/admin/_parts/Export/`, reached from a new "Export activity" button)
opens **blank** — no default range, no preselected action groups or accounts — lists every profile
including admins, and disables **Run** until a reason is typed; results download as a **JSON file**
(not an on-screen feed). Past exports are listed beneath the form (`audit.list({ action:
'audit.export' })`) and are tappable to **re-run** their stored filter as a new audited export
prefixed "Re-run:". Admin-only, not step-up gated (consistent with the other per-profile admin
actions).

## What is real vs. stubbed (prototype intentionally)

- **Auth** is mocked: names, PINs and passwords are stored and compared as plain
  strings; seed accounts `admin/admin` (name "Manager") and `staff/staff` (name
  "Sam") with PINs `4321` / `1234`. Production → hashed server-side. Sign-in is
  **username/password first** (`Login`); a remembered ("Remember this device")
  terminal re-auths with the PIN (`Unlock`) after a 5-minute idle lock; a
  non-remembered device prefills the last username. `AuthContext`
  (`ui/app/AuthContext.tsx`) manages the active session: "remember this device"
  flag, idle lock, epoch-based revocation, and the remembered `lastUsername`.
  PIN/password are never logged.
- **Prototype / developer panel** (`ui/screens/proto/ProtoPanel/ProtoPanel.tsx`)
  is opened by a **hidden top-left `DevTrigger`** (`ui/app/DevTrigger.tsx`),
  present on every view — NOT a logo gesture (the logo now only goes home /
  long-press signs in). Gated on `isPrototype` (env.ts) — i.e. the local adapter
  selection, NOT `import.meta.env.PROD`: the deployed GitHub Pages demo is itself a
  production `vite build`, so gating on `PROD` previously hid the panel on the very
  deployment that needs it. **Stripped to three centred controls, in order: QR,
  Scan to pair, Reset.** The old demo-card selector, card-state jumps, view-jump
  buttons and sign-in shortcut were removed — every prototype card starts at zero
  and registration rotates which preset token is handed out. Prototype-only;
  dropped from a real server-backed build.
- **Reset device** is **role-aware and reload-free** (`PairingContext.reset()`).
  A **host / unpaired** device fully wipes: `Services.reset()` →
  `IndexedDbStore.reset()` **empties every store on the live connection and
  re-seeds** — deliberately NOT `deleteDatabase` + reopen, which can hang silently
  in Safari (no success/error/blocked event) and leave the store on a dead
  connection until a reload (the real cause of "after a reset the dev panel shows
  nothing and card creation fails until a reload"). Clearing in place keeps the
  same open connection, so the store is usable the instant reset resolves. Storage
  is cleared **first** (recognition can't survive even if the data wipe throws),
  then the app re-resolves via `navigate('/')` — no `window.location.reload()`.
  A **paired client** does a
  **light** reset: it clears only its own storage (preserving the pairing snapshot
  and the live RPC link) so it behaves like a brand-new customer while the till
  keeps all data. A host reset additionally sends an unpair signal to its clients
  (the "server" is gone). Prototype-only.
- **`ApiStore`** is a production skeleton — each method maps to an HTTP call but
  throws in the prototype (no backend). Shows the contract; one-line swap.
- **`ServerTransport`** is a production placeholder — every method throws. The
  prototype uses `PeerTransport` (PeerJS + TURN).
- **`ServerWalletProvider`** is a production placeholder — every method throws.
  The prototype uses `StaticWalletProvider` (`adapters/wallet/StaticWalletProvider.ts`):
  `ensurePass` returns a pre-generated walletwallet.dev URL from `wallet/passes.ts`;
  `pushUpdate` is a no-op (WalletWallet Free tier = static snapshot; web card is
  source of truth). First three cards get preset tokens (`PROTOcard0000000000001..3`)
  aligned to real pass serials; later cards rotate stably for display only. Wallet
  button lives inside `EnlargedQrOverlay`, mobile-only, OS-detected. Selected via
  `VITE_WALLET=static` (default). Real pass provisioning (PassKit + APNs / Google
  REST) requires the backend.
- **Suspicious-activity alerts** (`domain/alerts.ts`): pure monitoring only, **two**
  detectors (self-dealing, repeat-target), thresholds admin-configurable. No
  automatic blocking or notification is triggered. Alerts surface in Admin → Alerts.
  See the Staff integrity & observability acceptance (E9) table above.
- **Reward-notification email** is sent via `EmailJsMailer` when a customer has
  an email address. Real delivery depends on the EmailJS template
  (`template_5ic2z7d`) defining the params the app sends: `to_email`, `mail_kind`,
  `recovery_link`, `expiry_minutes`, `subject`, `message`, `reward`, `card_link`.
  No opt-out UI yet (see Known gaps).
- **Recovery email** (single-use link) similarly depends on the same EmailJS
  template. When EmailJS is unconfigured (`NoopMailer`), the code path executes
  but no email is sent — the uniform-response behaviour (no enumeration) is
  preserved either way.
- **Storage** is IndexedDB in the browser — per-device, demo only, not secure
  storage. Cross-device state is reconciled by auto-provision-on-scan. When devices
  are **paired** (`adapters/sync/`), the customer device reads from the staff
  device's store live.
- **`adapters/sync/` (device pairing)** is PROTOTYPE-ONLY. It uses PeerJS + TURN
  as a stand-in for the production server's coordination role. In production the
  sync layer is removed; the server mediates all state.
- **Build-time secrets** (`VITE_EMAILJS_*`, `VITE_TURN_*`) are baked into the
  static bundle — publicly readable, throwaway, rotate after demos.

## Test coverage

Three separate suites since Phase 10 split the repo into packages — there is no longer a single
`npm test`. `npm test -w @cafe/shared` runs **73 tests** (green, independent of the SPA).
`npm test -w @cafe/web` runs **9 of 47 test files failing to load, 38 passing (189 tests)** —
includes co-located `packages/web/src/ui/**/*.test.tsx` via the extended `test.include` in
`vite.config.ts`; red for exactly the Phase 6 reasons (below). `npm test -w @cafe/server` runs
**390 server tests** against a real Postgres.

- **`@cafe/shared` — `packages/shared/tests/`** — `loyalty`, `rewards` (rewards-as-objects pure
  logic: `mintFold` mint-on-cross + multi-mint, `unspentRewards`, `cardProgress`,
  `validateRedemption`, `isOverCap` — `planUndo` removed, Appendix E Phase 1),
  `tokens` (incl. reward identifiers), `validation` (pure logic), `alerts` —
  pruned to **`self-dealing`** (attributed accrue/redeem pairing) and
  **`repeat-target`** against configurable thresholds (velocity, off-hours,
  outlier-share, oversized multi-add removed, Appendix E Phase 2). These six suites moved out of
  the SPA's test run in Phase 10 — they are the contract's own tests and stay green whatever state
  `@cafe/web` is in.
- **`@cafe/web` — `packages/web/tests/services/`** — `Customer` (incl. `selfRegister`, `provisionFromToken`,
  `nextCardToken`, `selfDelete`), `Loyalty` (incl. reward-notification path,
  `getAlerts()` over attributed events + configurable thresholds, and the
  rewards-as-objects unified commit: `commit` mint-on-cross, `over_cap`/
  `customer_not_found` short-circuit, idempotent retry, subset-redeem,
  one-email-per-mint, `getStats` counts `reward.redeemed` audit events, plus
  `reverse` — `undo` removed, Appendix E Phase 1), `Recovery`, `Staff` (incl.
  `loginWithPin`, `setPin`, `revokeAllSessions`), `Config` (incl. the four
  detector-threshold fields), `Audit` (incl. `exportActivity` — empty-reason
  refusal, `audit.export` row, reason trim/cap), plus the `Services`
  composition-root wiring.
- **conformance —** `packages/server/src/testing/dataStoreConformance.ts` (moved from
  `tests/conformance/` in Phase 10), the
  **store-agnostic `DataStore` suite** (41 tests): customers and the tombstone,
  the ledger and derived balance, the atomic commit (mint-on-cross, multi-mint,
  idempotent replay, subset redeem, `not_owner`, `over_cap`,
  `customer_not_found`, redeem-only), rewards, staff/PIN/config, recovery codes,
  the ranged multi-value `AuditFilter`, stats and the snapshot round-trip. Now run
  **only** against `PostgresStore` from `packages/server/src/PostgresStore.test.ts` — its
  `IndexedDbStore` counterpart was deleted in Phase 6, so the suite is reframed in its own header
  as `PostgresStore`'s specification rather than a cross-store contract; the missing second harness
  is explained rather than merely missing.
- **`@cafe/web` adapters/** — `ApiStore` (every method rejects as a stub), `NoopMailer`,
  `LocalStorageIdentityStore`.
- **Deleted in Phase 6, listed here because they used to be this section's bulk:** the
  `IndexedDbStore` suite (the seed, the short-code backfill, the v5 clean-reset upgrade, the
  wedged-database self-heal, `reset()` in place, the retired `redeemReward` path), the
  `adapters/sync/` suites (`FakeLink` round-trip, `ConnLink` / `joinHost` / `PeerJsHost`),
  `adapters/wallet/` (`StaticWalletProvider`), `PeerTransport`, `EmailJsMailer`, and
  `ui/common/storageSnapshot` (the pairing push/pop). The adapters they covered are gone, so
  the tests went with them — **this is not missing coverage, it is a removed feature.** What
  the store suites proved about the *port* survives in the conformance suite above.
- **`@cafe/web` ui/app/** — `session` (`packages/web/tests/ui/app/session.test.ts`): the pure session
  decision logic from `AuthContext` — `parseSession` validation, `reconcile`
  (epoch revocation, idle→locked for trusted vs anon for ephemeral), `isIdle`
  boundary. `LogoGestures` (`packages/web/src/ui/app/LogoGestures.test.tsx`).
- **ui/components/** — co-located tests for each shared component: Logo, Heading,
  Button, Field, CupStamps, Sheet, Qr, Overlay, Toast, PinPad, LoyaltyCard,
  Slider, ContextBanner.
- **ui/screens/** — co-located tests for each screen: Welcome, Register, LostCard,
  RecoverConsume, Card, CardMenu (customer); Login, Unlock, Panel ("Your last
  hour" actor+time scoping), Scan + TopBar, ScanView, CustChip, StateLabel
  _parts (incl. the 3-second pre-commit hold: cancel writes nothing, timeout/
  "Commit now" writes once, `over_cap` drop-back) (staff); Admin (incl. the
  Configure "Activity alerts" thresholds, `StatDetail` chart-only, `AccountSheet`
  without activity history, and the `_parts/Export/` sheet — blank form, reason
  gate, JSON download, past-exports re-run) (admin); ProtoPanel (proto).
- **qr/** (`encode` — incl. `cardPayload` URL format and `tokenFromCardScan`,
  `scan` with html5-qrcode mocked), **wallet/** (`passes.test.ts` — preset
  tokens, serial lookup, URL construction, OS detection),
  **config/** (`env` flag mapping incl. `googlePlaceId`, `walletKind`, `links.ts` URL building).

**Server layer** (`npm test -w @cafe/server`, 390 tests, **needs a real Postgres** at
`TEST_DATABASE_URL` — the run aborts in `globalSetup` without one, because a suite that skips
itself green proves nothing): `env` (boot-time validation, incl. `COOKIE_SECURE` refusing to be
false in production), `logging` (PII redaction, including the 404 path that slipped past the
request serializer), `server` (`/healthz`, `/readyz`), `migrate` (fresh migration, re-run no-op,
immutability, and every schema constraint the backend rests on), `bootstrap` (first admin,
idempotent, argon2id), `auth/cookies` + `auth/rateLimit` (pure units — parsing, attribute
correctness, failure counting, lockout expiry, the memory sweep), `auth/sessions` (issue, resolve,
the idle lock, epoch revocation, disabled-account invalidation, CSRF binding, expiry sweep),
`routes/auth` (the five routes end to end over `app.inject`: sign-in and its identical answer for
every failure mode, the argon2-digest-as-password rejection, the three lockouts, the idle
lock→PIN-unlock round trip, another account's PIN refused, "sign out all devices", the CSRF and
origin boundaries, a customer session refused staff access, and a log with no credential in it),
`routes/authz` (**the authorization matrix** — every route in the surface × five real devices
(anonymous, two different customers' phones, a till and an admin's), proving each tier is refused
everything above it *and* that every entitled caller gets through, since a matrix that only proved
refusals would pass with every route returning 403), `routes/customers` (the §4 contract fixes: the
body's `staffId` discarded, the body's token discarded, the server-written audit rows, a replayed
commit writing no second row, a reversal's points derived rather than accepted, the tombstone
freeing its address), `routes/identity` (`/me`: HttpOnly, one card at a time, a till never bound),
`routes/staff` (no credential serialized, the argon2-digest-as-password rejection again at the
reset routes, a disabled account's sessions ending at once, and the lockout invariant), `routes/config`
(the clamps, the CHECK-aligned floor of 2, `sessionEpoch` refused), `routes/activity` (`GET /audit`
pinned to the caller's own actor **however the filter is phrased**, an admin no wider than anyone
else, `POST /audit` writing nothing, the ranged/capped ledger read), `routes/snapshot`, `detection`
(the two detectors fed through the store the routes write to, the window, the thresholds, no role
exemption, dismissal), `routes/guardrails` (BACKEND-PLAN §6's acceptance criteria as tests: no
route reaches `getStaffByPin`, no `undo` anywhere in the server, no export surface, cross-account
reads confined to detection and `activity.ts`, the banned paths, and a **route inventory** pinning
the entire surface so a new route fails until its tier is decided), and `PostgresStore` — the
shared conformance suite plus what only a real database can be held to: the **row lock** (a commit blocks on a row another connection holds; two
tills serialize; simultaneous redemptions spend once; a concurrently-retried commit writes once —
each race held open by a third connection so the overlap is a fact, not a scheduling hope), the
**tombstone** (token/short code erased, address freed, commits refused), **credentials at rest**
(argon2id, hashed recovery codes), the refused `redeemReward`, and the integrity the browser could
not enforce.

**End-to-end layer:** `packages/web/e2e/` (Puppeteer, headless Chrome, `npm run e2e`) drives the
built app — runs against `npm run preview`. Not part of `npm test`; run manually
or in CI as a separate step. Catches regressions at the rendered-DOM level that
unit tests cannot.

## Conventions worth knowing before editing

- `domain/` stays pure (no I/O/React/browser). Unit-test new domain logic.
- All port methods (`DataStore`, `Transport`, `Mailer`, `IdentityStore`,
  `WalletProvider`) return Promises — never add a sync storage or I/O path.
- Ledger is append-only; model corrections as `reversal` entries.
- Never put PII in the QR, logs, or audit `details`. Never log a PIN.
- Only `services/Services.ts` names concrete adapters.
- New adapter? Implement the full port and wire it solely in the composition root.
- `packages/web/src/config/links.ts` (`appUrl`) is the single place that builds absolute URLs
  for QR payloads and emailed links. Do not hard-code `window.location` elsewhere.
- `packages/web/src/config/env.ts` owns all env-var reads (`VITE_TRANSPORT`, `VITE_EMAILJS_*`,
  `VITE_TURN_*`, `VITE_GOOGLE_PLACE_ID`, `VITE_WALLET`, `baseUrl`,
  `isEmailConfigured`, `googlePlaceId`, `walletKind`). Read from there, not
  `import.meta.env` directly.
- `packages/web/src/config/cafe.ts` holds static café public details (name, address, Maps URL,
  contact email). Use it in UI rather than hard-coding strings.
- **UI design system:** `packages/web/src/ui/theme/` replaces the old monolith `theme.css`.
  Slices: `tokens.css` (design tokens — forest/sage/blush/cream/terra palette,
  Fraunces/DM Sans/DM Mono fonts), `base.css` (reset, `.screen` shell, utilities,
  `bg-*` gradients, focus-visible ring, reduced-motion, `card-hint`),
  `keyframes.css`. All imported once via `packages/web/src/ui/theme/index.css` in `main.tsx`.
  No monolith; no `styles.css`. Tokens always win — import order is handled in
  `index.css`.
- **UI components:** `packages/web/src/ui/components/<Name>/` — each shared presentational
  component is its own folder (`Name.tsx` + `Name.css` + `Name.test.tsx`). No kit
  barrel export; import directly from the component folder. No business logic in
  components.
- **UI structure:** app-level infra in `packages/web/src/ui/app/` (AuthContext, EntryResolver,
  routes, `LogoGestures` — the global shell chrome is gone; screens own their
  headers). Screens in `packages/web/src/ui/screens/<area>/<Screen>/` (folder-per-screen:
  `Screen.tsx` + `Screen.css` + `Screen.test.tsx`); screen-scoped parts live in
  their screen's `_parts/` sub-folder; only truly shared pieces live in
  `packages/web/src/ui/components/`. Shared prototype/pairing scaffolding in
  `packages/web/src/ui/common/`.
- **`AuthContext`** (`packages/web/src/ui/app/AuthContext.tsx`) manages the staff/admin session:
  trusted vs. ephemeral device, inactivity lock, epoch revocation. Replaces the old
  `SessionContext`. Staff/admin guards use `useAuth` inside each screen — no
  `RequireAuth` wrapper component.
- **Navigation:** no home dashboard for customers. Recognized customer → `/card/:token`
  directly. Unrecognized → `/welcome`. Signed-in staff → `/staff`, admin → `/admin`
  (role-aware home). Entry routing is `EntryResolver` at `/`. Logo gestures handled
  by `LogoGestures` (`packages/web/src/ui/app/LogoGestures.tsx`): **tap → home**, long-press
  ≥600ms → staff sign-in. The Prototype/developer panel is opened by a separate
  hidden top-left `DevTrigger` (gated on `isPrototype`, not `import.meta.env.PROD`),
  not a logo tap. There is no global "Staff sign-in" subtitle in the shell.
- **Reward threshold is 9** (`pointsPerReward: 9` in `adapters/storage/schema.ts`
  seed) — nine purchases earn the reward. The card renders a fixed **10-cup
  showcase** (`CupStamps showcase`): the 9 earnable cups plus a FREE reward cup
  that is **pre-stamped** as the prize. There is **no welcome cup** — the first
  stamp is earned, not on the house — so a brand-new card shows 1 of 10 lit and
  "9 more for a free coffee". No "Gold" tier badge.

## Known gaps / not built (by design or deferred)

- No backend, money handling, gifting/suspended-coffee, marketing, advanced
  analytics, native apps, multi-tenant (out of scope — SPEC §2).
- `cardInactivityDays` is configurable but no expiry job runs (prototype).
- Camera scanning needs HTTPS/localhost. Manual entry accepts the short
  **card code** (Crockford base32) as a camera-fail fallback. The scan camera is
  acquired **once per scan-screen visit and kept warm** (pause/resume between
  customers via `qr/scan.ts`) so iOS Safari doesn't re-prompt for permission on
  every scan. Cross-*page-load* persistence is a browser/OS setting (iOS: set the
  site's Camera permission to "Allow") — the page can't force it.
- **Reward-notification opt-out** is not yet surfaced in the UI. Email is sent
  whenever the customer has an address on file.
- **Two-device TURN-relayed verification on cellular** is implemented but can only
  be confirmed via a manual live demo — it is not automatable in CI.
- **Apple Wallet live updates** require an Apple developer account and backend
  (PassKit + APNs). The walletwallet.dev passes are prototype-only (`pushUpdate`
  is a no-op); production wallet passes need the backend.
- **Wallet passes beyond the first three cards** (preset tokens exhausted): the
  wallet button renders and links, but the pass won't resolve to the card. Noted
  in `wallet/passes.ts`.
- **"Coffees today" admin stat** is approximated by counting today's accrual audit
  events, not points. A windowed `LoyaltyService` stat is a follow-up.
- **Step-up PIN re-auth** gates program-config save and "Sign out all devices".
  Per-row staff mutations (create/reset-password/set-PIN/toggle-active) are not
  step-up gated — deliberate tuning decision, flagged here for future review.
- **B4 (review prompt)** was dropped in the Ckyka rebuild — the old `ReviewPrompt`
  is gone and the new UI spec doesn't include it. Re-add to the customer card flow
  if the café still wants the post-redemption Google-review nudge.
- **B6 remainder** (light/dark mode toggle, hide-login hardening, progressive card
  animations, menu page) — intentionally deferred or dropped; no menu page by
  design (dropped per requester).
- **B5** (own-card photo) — explicitly out of scope per requester.
- **`cafeContactEmail`** in `config/cafe.ts` is a placeholder; replace with the
  real address before go-live.
- **Prototype→production switch is not a single adapter swap (sync-layer
  coupling).** The `Transport` port (`PeerTransport`↔`ServerTransport`) and the
  raw PeerJS/WebRTC handling (`adapters/sync/PeerJsLink.ts`) are cleanly
  swappable, but the *device-pairing feature* is wired through several layers and
  must be carefully unpicked when going server-backed. **Switch checklist:**
  (1) remove the `adapters/sync/` module; (2) drop `services.sync = { observable,
  switchable }` from the composition root (`services/Services.ts`) — services can
  bind directly to the local/HTTP store; (3) stop mounting `PairingProvider`
  unconditionally in `main.tsx`; (4) remove the `usePairing().dataVersion` refetch
  refs from the Card, staff Panel, and Scan screens (the host's `changed`→
  `dataVersion` signal leaks into screen effect-deps; production wants a generic
  no-op/server-push behind that); (5) remove the `/pair` route. The pairing model
  itself: **host/client, not a mesh** — every device boots hosting, the device
  that *scans* becomes a client of the scanned host (`PairingContext.joinAs`); one
  host serves **many** clients; clients have no local store — every read/write is
  an RPC (`PeerClientStore`) to the host's `StoreServer`, which runs it on the
  host's IndexedDB and pushes `changed` pings. Decision (2026-06-24): the pairing
  *behaviour* was refined (reversible snapshot overlay, role-aware reload-free
  reset, no staff auto-redirect, clients show the host's QR — see divergence e),
  but the **production de-coupling itself is still deferred**; the 5-step checklist
  above stands and is revisited when we begin server testing.
  See divergences e, f for the prototype-only rationale.
- **Custom map styling deferred to a Maps JS migration (planned).** The Find-us
  map uses the keyless `output=embed` iframe (roadmap base + a warm CSS filter +
  card-style frame). Feature-filtering (show only street names + bus/transit
  stops) and a custom **loyalty-token pin** aren't possible with the keyless
  embed — they need the **Google Maps JavaScript API** (a referrer-restricted key
  + a `styles` array + a custom marker rendering the `LogoMark`). Decision
  (2026-06-24): keep the keyless embed for now; do the custom style + token pin
  when we migrate to Maps JS.
- **iOS home-screen `localStorage` durability (under investigation).** On a
  device that "Add to Home Screen"s the app, recognition (the customer token in
  `localStorage`) appears to not survive a reload, while a normal Safari tab keeps
  it. iOS treats the home-screen web app as a separate, more aggressively-purged
  storage context, and `localStorage` writes there are historically unreliable.
  Card *data* lives in IndexedDB, which is generally more durable. A prototype
  **storage diagnostic** in `ProtoPanel` surfaces what survives (recognition vs
  IndexedDB count) to confirm. If IndexedDB is durable there, the fix is to back
  `IdentityStore` with a device-local IndexedDB (woven into the pairing
  snapshot/reset lifecycle); the durable production answer remains the server
  cookie (divergence d).
- **Short shareable recovery code — DONE.** Cards now carry a **`shortCode`**: an
  8-char **Crockford base32** handle (no I/L/O/U), unique per card, assigned by
  the store on create (`domain/tokens.ts` `generateShortCode`/`normalizeShortCode`/
  `formatShortCode`; `DataStore.getCustomerByShortCode` + a `byShortCode` index,
  schema v4 with backfill). The **token stays the identity** (QR/wallet/recovery);
  the short code is a camera-fail lookup handle. It's shown on the card (`CKY ·
  K39X-Q4T7`) and the scan view's **manual entry is back**, accepting the short
  code (`LoyaltyService.getStateByShortCode`). Production note: the lookup should
  be rate-limited server-side.
- **Recovery after Reset requires pairing.** Self-service recovery resolves
  the customer's card from the store currently active on the device. After a
  Reset, the customer device has a blank local store; recovery will only find
  the card if the device is paired to the till (whose store acts as the server).
  A reset customer device must pair before attempting `/lost`.
- **JSON snapshot export/import does not carry rewards or reward events.** The
  `Snapshot` type and `importAll` were not extended for the three new schema-v5
  stores (`rewards`, `rewardEvents`, `idempotencyKeys`). `importAll` explicitly
  clears those stores on restore so no orphaned rewards survive a backup→restore
  cycle, but the rewards themselves are lost. Extending `Snapshot` is a **deferred
  follow-up** (a code change, out of scope for the docs-only Phase 8 that closed the
  rewards-as-objects rework).
- **`reward.voided` `RewardEventType` has no producer (Appendix E, Phase 1).** It
  is kept in the schema per the locked decision (a production `reverse` would
  plausibly emit it), but with the post-commit undo removed, nothing in the
  prototype currently writes a `reward.voided` event. Not a bug — flagged so a
  future `reverse`-voids-a-reward feature doesn't get mistaken for already built.
- **Appendix E — explicitly deferred, not dropped:**
  - **Staff-facing disclosure surface** (a "your actions are logged/reviewable"
    tripwire on the staff terminal) — not built.
  - **Notify-on-export** — no staff/customer notification channel exists or is
    planned; an export is silent except for its own audit row.
  - **Retention / compaction** — all ledger, audit, reward-event, and export
    records are kept **unbounded**. This deliberately sidesteps the balance-
    derivation-from-pruned-ledger trap, but means storage grows without limit —
    revisit with a compaction strategy before any real deployment.
  - **Device-ID per-terminal scoping** — the staff "your last hour" view scopes
    by signed-in `actorId`, not by physical device. True per-terminal identity is
    inherited for free at the production move (each device becomes its own
    identity there); not built in the prototype.
  - **Geofence / out-of-hours lock** — not built.

## Spec divergences (prototype vs. production)

These are known differences between prototype reality and the production spec.
They are intentional prototype simplifications, not bugs.

a. **Per-device IndexedDB.** Customer PII entered during self-registration lives
   only on the customer's device. When staff scan that token, auto-provision
   creates a token-only card on the staff device. The customer's full record is
   never automatically synced — that is the production backend's job.

b. **EmailJS template variables.** The prototype sends the following variables to
   the EmailJS template: `to_email`, `mail_kind`, `recovery_link`,
   `expiry_minutes`, `subject`, `message`, `reward`, `card_link`. The template
   (e.g. `template_5ic2z7d`) must define these; if it does not, emails send
   successfully but render incorrectly. This is an ops concern, not a code bug.

c. **Build-time secrets in static bundle.** TURN credentials and EmailJS keys are
   baked into the deployed JavaScript. They are throwaway demo credentials, rotated
   after demos. The production architecture moves these to the server.

d. **No server-side session for identity.** `IdentityStore` uses `localStorage`
   in the prototype (`adapters/identity/LocalStorageIdentityStore.ts`, key
   `cafe-loyalty.customer`, opaque token only — no PII). Clearing browser storage
   removes the identity link; self-service recovery re-establishes it. Production
   uses a server-side session or cookie.

   *No cookies are used anywhere in the prototype.* Switching prototype
   recognition from `localStorage` to a JS-set cookie (`document.cookie`) would
   **not** improve durability: iOS Safari ITP evicts script-writable storage —
   `localStorage`, IndexedDB, **and** client-set cookies alike — after ~7 idle
   days. Only a **server-set HttpOnly cookie** survives longer, and that needs the
   backend the prototype doesn't have. So `localStorage` is retained deliberately;
   durable iOS recognition is strictly a production (server-cookie) concern, to be
   revisited once we test on a server.

   Recognition recap (all three storage mechanisms): **IndexedDB** (`cafe-loyalty`
   DB) is the actual database — `config`/`staff`/`customers`/`transactions`/
   `audit`/`recoveryCodes`. **localStorage** holds three small flags —
   `cafe-loyalty.customer` (customer token = `IdentityStore`),
   `cafe-loyalty.staffDevice` (trusted staff/admin session), `cafe-loyalty.lastUser`
   (sign-in prefill). **sessionStorage** holds `cafe-loyalty.staffSession`
   (ephemeral, non-remembered staff session). A device is "recognized" by a
   token/session in localStorage that points into IndexedDB records; staff-vs-admin
   role comes from the `StaffAccount` record, not the device.

e. **Device pairing is a prototype-only construct.** `adapters/sync/` uses PeerJS
   to let the till act as a temporary server for many customer devices'
   `DataStore`s simultaneously. `PeerJsLink.ts` now exports `ConnLink` (single
   connection), `joinHost()` (client side), and `PeerJsHost` (one peer, many
   clients; `onClient` / `onCountChange` / `count` / `unpairAll` / `close`). One
   `StoreServer` is created per connected client so change notifications fan out to
   every paired device. `SyncMessage` gained a `{ t: 'unpair' }` variant sent on
   both sides when unpairing; after unpairing each device resumes hosting. This is
   the no-backend stand-in for server-mediated state coordination. In production the
   server handles this and the entire sync layer (`adapters/sync/`, `PairingProvider`,
   `/pair` screen) is removed — it is not a path toward the production sync architecture.

   *Pairing UX (2026-06-24):* pairing is a **reversible, non-destructive overlay**.
   On join, `snapshotAndClear()` (`ui/common/storageSnapshot.ts`) captures the
   device's `localStorage` + `sessionStorage` into one reserved key
   (`cafe-loyalty.__pairSnapshot`) and clears the rest, so a paired device starts
   fresh as a new customer; unpair (voluntary **or** host-forced) calls
   `restoreSnapshot()` to pop it back. A leftover snapshot at boot can only mean an
   unclean exit (a PeerJS link never survives a reload), so `main.tsx` runs
   `restoreSnapshot()` before any provider reads storage to self-heal. **No device
   is auto-routed to staff** on pairing (every joiner → `/welcome`), and a client
   surfaces the till's id (`joinedHostId`) so the dev panel shows the **host's QR**
   — a third device can join by scanning a client's screen and connects straight to
   the host. A host reset forces unpair on its clients (they restore their snapshot
   and see a "till disconnected" toast).

f. **Prototype UX scaffolding (DevTrigger, ProtoPanel, Reset, pairing, QR-in-panel).**
   The spec does not define demo-management UI. The prototype surfaces it in
   `packages/web/src/ui/screens/proto/ProtoPanel/ProtoPanel.tsx`, opened by a hidden top-left
   `DevTrigger` (`packages/web/src/ui/app/DevTrigger.tsx`) present on every view (build-flag
   gated, non-production). The panel is stripped to three centred controls — pairing
   QR, Scan to pair, Reset. Long-pressing the logo (≥600ms) goes directly to
   staff/admin sign-in; a plain logo tap goes home. `/pair` is scan-only: arriving
   with a `?host=` parameter auto-joins without user interaction; `QrScanner`
   receives `allowManual={false}`. Pairing role (till vs. customer) is determined by
   which device scans — no explicit role selector or login required. All of this is
   prototype scaffolding with no production equivalent.

g. **UI file layout diverges from SPEC §12.** SPEC §12 specifies
   `src/ui/{customer,staff,admin,auth}/` + `src/ui/common/`. The rebuilt frontend
   (Ckyka reference-UI) uses
   `packages/web/src/ui/{theme/,components/<Name>/,screens/<area>/<Screen>/,app/,common/}`
   (physically moved under `packages/web/` in Phase 10; the internal shape is unchanged).
   The domain, ports, adapters, and services layers are unchanged. The divergence is
   UI-structure-only and does not affect the production swap path. Recorded here;
   `docs/SPEC.md` is not edited.

k. **UI fully reskinned to the Ckyka reference bundle.** The entire `src/ui/`
   presentation was replaced to match an approved pixel reference (12 styled view
   files + donor `theme.css`). Behavior, wiring, and the backend layers are
   unchanged. Removed: old `src/ui/kit/`, old flat `src/ui/screens/` files, old
   `app/Shell`, monolith `src/ui/theme.css`, `src/styles.css`. The "Gold" tier pill
   on the card is intentionally static — v1 has no tiers; it is decorative only.
   Admin program-config edits now use an in-app **`ProgramEdit`** sheet (value
   Field + PIN), replacing the old browser `prompt()` (which mobile Safari
   suppressed). Demo state-jump in ProtoPanel is limited to preset reseeds;
   arbitrary point manipulation is not surfaced.
   Gesture anchor: the small cup+sunburst mark is present on the card, register,
   and lost-card screens; `LogoGestures` attaches the tap/long-press handlers there.

h. **WalletProvider pushUpdate is a no-op (prototype).** WalletWallet Free tier
   produces a static pass snapshot. `StaticWalletProvider.pushUpdate` does nothing.
   The web card is the source of truth. Production `ServerWalletProvider` replaces
   this with live PassKit + APNs / Google REST updates.

i. **"Coffees today" admin stat is approximate.** Counted by today's accrual audit
   events (1 event = 1 visit), not summed points. A proper windowed `LoyaltyService`
   stat is a follow-up task.

j. **Step-up PIN re-auth scope (tuning).** Step-up gates program-config save and
   "Sign out all devices" revocation. Per-row staff mutations (create/reset-password/
   set-PIN/toggle-active) do not require step-up. Deliberate scope decision — flagged
   here for future tightening if the threat model requires it.

l. **`commitCounterTransaction` atomicity is IDB-tx scope only (no row lock).**
   The prototype's single IndexedDB `readwrite` transaction over the six stores
   provides atomicity within one browser context, but IndexedDB has no row-level
   locking primitive. Two concurrent commits from different browser contexts
   (e.g. two paired devices submitting simultaneously) are serialised by the IDB
   engine on a best-effort basis with no explicit lock ordering guarantee.
   Production uses `SELECT … FOR UPDATE` (PostgreSQL) to provide true row-level
   locking. Idempotency dedup (`idempotencyKeys` store) guards against retry
   double-writes regardless of context.

   **Production half built (BACKEND-PLAN Phase 2).**
   `packages/server/src/PostgresStore.ts` takes `SELECT … FOR UPDATE` on the
   customer row before it reads the balance or writes anything, and a race test
   holds the row open on a third connection so both commits are provably in
   flight at once — it fails when the lock is removed. The divergence itself
   stands as written: it describes the *prototype*, which still has no row lock
   and cannot get one. It closes only when the prototype adapter retires.

m. **Cross-account activity is no longer casually browsable — access moved behind
   a reason-gated, audited export (Appendix E).** SPEC §8.7 describes an admin
   "audit log: filterable list of actions" as an open viewer. The prototype now
   presents the staff terminal's own activity **only** as an actor-scoped,
   1-hour-capped list (no full history, no other staff's actions), removes the
   admin home's cross-account Activity feed and `StatDetail`'s per-action list
   entirely, and removes `AccountSheet`'s per-profile activity history. The only
   way to see cross-account or historical activity is the admin **Export**
   workflow (`ui/screens/admin/_parts/Export/`, `AuditService.exportActivity`):
   a blank-by-default filter (time range · action(s) · account(s) incl. admins)
   that **requires a typed reason**, produces a downloaded JSON file, and is
   itself written to the audit log as an `audit.export` row (so "who looked at
   what and why" is always reconstructable). This is a deliberate tightening
   beyond SPEC §8.7's plain filterable viewer, not a regression — the underlying
   audit log is unchanged and still fully queryable via export.

n. **Suspicious-activity detector set trimmed from six to two, thresholds admin-
   configurable (Appendix E).** SPEC does not enumerate exact detectors; the
   prototype previously shipped velocity, repeat-target, oversized multi-add,
   off-hours, and outlier-share checks against hardcoded `DEFAULT_THRESHOLDS`.
   In a single-café shop the first four fired on ordinary trading rather than
   fraud, so they were removed, leaving **self-dealing proximity** (rebuilt
   against attributed `loyalty.accrue`/`loyalty.redeem` audit events — the prior
   `earn-then-redeem` detector matched a ledger `type==='redemption'` value the
   rewards-as-objects rework had stopped writing, so it had been silently firing
   on nothing) and **repeat-target**. Thresholds for both now live on
   `ProgramConfig` and are editable in the admin Configure panel rather than
   hardcoded. Alerts remain monitoring-only; no role is exempt.

o. **The rewards-as-objects 5-second post-commit undo is retired, replaced by a
   3-second pre-commit hold (Appendix E, Phases 0–1).** `DataStore.undoCommit`,
   `LoyaltyService.undo`, and `domain/rewards.ts` `planUndo` (plus their sync
   allow-list entry and tests) are deleted outright — there is no post-commit
   reversal path in the prototype. The staff Scan instead **stages** the commit
   behind a blocking 3-second countdown (Cancel/"Commit now") before anything is
   written, so an operator error is caught before it becomes a ledger entry
   rather than reversed after. SPEC §8.5's `reverse`-via-`reversal`-entry
   correction primitive (for genuinely after-the-fact corrections, e.g. days
   later) is unaffected and remains in place. This divergence retires (does not
   contradict) the C9/D10 undo acceptance rows recorded during the rewards-as-
   objects rework — see the "Rewards-as-objects: formats" section above.

p. **PIN sign-in stops being a global PIN lookup (BACKEND-PLAN §4-B, Phase 3).**
   The prototype's `StaffService.loginWithPin` calls `DataStore.getStaffByPin`,
   which searches **every** active account for whichever one holds that PIN — so
   a PIN alone both identifies and authenticates. In-process that is merely
   convenient; over HTTP it is an unauthenticated credential oracle across the
   whole staff table at four digits, brute-forceable in minutes. The server's
   `POST /auth/unlock` therefore verifies the PIN **against the account this
   device's session already names**, rate-limited (5 misses, 15-minute lockout).

   **Consequence:** in a server-backed build a device with no session cannot PIN
   in at all — it signs in with username + password first, which is what
   "remember this device" already means in the UI. `getStaffByPin` survives in
   both stores (the conformance suite holds them to the same answer) but has no
   route, and `packages/server/src/routes/guardrails.test.ts` fails if one
   appears. This is a genuine behaviour change, not a refactor.

q. **The staff session moves server-side: real idle lock, real revocation
   (BACKEND-PLAN Phase 3).** The prototype keeps the staff session in
   `localStorage`/`sessionStorage` and reconciles it in `ui/app/session.ts`, so
   the 5-minute idle lock and the `sessionEpoch` check are advisory — they are
   decided by the device being asked to lock itself out. The server keeps
   `sessions` rows behind an HttpOnly cookie and decides both itself: idle past
   5 minutes locks a remembered terminal and ends a non-remembered one, a
   disabled or deleted account loses its live sessions immediately, and "sign out
   all devices" **deletes every staff session row** in the same transaction as
   the epoch bump rather than waiting for each device to notice.

   Two details differ from the prototype's model and are deliberate. The epoch
   is a **counter** (`session_epoch + 1`), not `Date.now()` as
   `StaffService.revokeAllSessions` writes — `program_config.session_epoch` is an
   `integer` and a millisecond timestamp overflows it; monotonic is all the
   comparison needs. And **customer sessions obey neither rule**: they never idle
   out (a fortnightly customer must still be recognised — that recognition is the
   feature) and "sign out all devices" leaves them alone, being an action about
   staff terminals. The client-side timer in `AuthContext` stays as the immediate
   UI affordance; it is no longer what decides.

r. **Four `DataStore` methods change shape at the HTTP boundary (BACKEND-PLAN
   §4-C/D/E, Phase 4).** The port is unchanged and every UI call site still
   compiles; what changes is what the *server* does with the call, because a
   trusted in-process call becomes an untrusted request.

   - **`appendAudit` writes nothing.** `POST /audit` answers `204` and appends no
     row. A client-supplied actor, role and action is not an audit log — the
     route that performed the action already wrote the row from the session
     actor. It answers 204 rather than 403 deliberately: there is nothing the
     caller could do about a refusal, and failing the call would break a service
     the swap is supposed to leave untouched. The attempt is logged at `warn`.
   - **`CounterTransaction.staffId` and `AppendTransactionInput.staffId` are
     discarded** and replaced with the session's actor. A customer's device
     cannot commit at all — `requireStaff` refuses it before the body is read.
   - **`listAudit` is pinned to the caller's own actor.** `GET /audit` overrides
     `actorId`/`actorIds` with the session's id, whatever the request asked for,
     and no tier widens it — an admin sees exactly their own rows. Cross-account
     activity is reachable only by querying the database directly.
   - **`listAllTransactions` requires a range and caps its page.**
     `GET /transactions` demands `from`/`to` (at most 366 days), caps at 1000
     rows and reports `truncated` rather than silently shortening. The *store*
     still returns everything, because the detectors and the stats derivation
     read it in-process where truncation would make both quietly wrong.

s. **Customer search moves out of the URL (BACKEND-PLAN §3-B-11, Phase 4).**
   `ApiStore.findCustomers` sketches `GET /customers?term=…`, which puts a name,
   an email or a phone number into the request line — the access log, the proxy
   log and the browser history. The server implements **`POST /customers/search`**
   instead; Phase 6 points the adapter at it. Two routes do still name a value in
   the path (`/customers/by-token/:token`, `/customers/by-code/:shortCode`);
   neither is PII — that is the point of the opaque-token design — but both are
   credentials, so `logging.ts` redacts that segment.

t. **The credential-reset routes take a plaintext, and say so
   (BACKEND-PLAN §4-A, Phase 4).** `setStaffPassword(id, passwordHash)` promises
   the client sends a digest; if the server stored what it was given, that
   "hash" *would be* the password. `PATCH /staff/:id/password` therefore takes
   `{ password }` over TLS and `PostgresStore` hashes it with argon2id. The port
   signature is unchanged; the wire field is named honestly, because naming it
   `passwordHash` is how the mistake happens. Relatedly, **no route ever
   serializes a `StaffAccount` whole**: `GET /staff` and `GET /export` blank
   `passwordHash` and drop `pin`, and there is no `GET /staff/by-username` —
   that lookup returns the account *with* its digests and is the prototype's
   sign-in path, which is now `POST /auth/login`.

u. **`LoyaltyService.getAlerts` cannot work over HTTP; detection moves to the
   server (BE-S-09, Phase 4).** The prototype derives alerts in the browser from
   `listAllTransactions` + two cross-account `listAudit` reads. Divergence **r**
   removes the second of those on purpose, so the derivation has to move: the
   server runs `domain/alerts.ts` **unchanged** in `packages/server/src/detection.ts`
   over a 30-day window and exposes **`GET /alerts`** (admin) returning `Alert[]`
   — findings, never rows. This is the only cross-account view in the API and it
   is the point of writing audit rows server-side: a client-written audit log
   means the detectors judge fraud using data the person committing it authored.
   **`GET /alerts` has no `DataStore` method behind it**, so Phase 6 has to
   decide how `LoyaltyService.getAlerts` reaches it — the one place in the plan
   where "no service rewrite" is under real pressure besides the offline posture.

v. **Two guards differ from `StaffService`'s, in opposite directions (Phase 4).**
   `StaffService.remove`'s "can't delete the last admin" check is **not** restated
   server-side: every staff route is admin-tier and refuses to act on the caller's
   own account, so the caller is always an active admin other than the target and
   the target is never the last — the branch is unreachable, and a branch no
   request can enter is a branch no test can cover. The invariant is asserted
   directly instead. In the other direction, **disabling is guarded where the
   prototype guards nothing**: an admin cannot switch their own account off,
   because a disabled account loses its sessions on the next request and the
   lockout is as complete as a deletion.

w. **Config clamping is stricter than `ConfigService.sanitizeConfig`
   (BACKEND-PLAN §3-B-12, Phase 4).** `PATCH /config` re-runs the client's
   arithmetic where a caller cannot skip it, and differs in three ways. Every
   numeric field gains a **ceiling** the client never needed (its inputs are
   spinners a person drives; over HTTP the value arrives from whatever chose to
   send it). `selfDealCount` and `repeatCount` floor at **2, not 1** — migration
   001's CHECK is `BETWEEN 2 AND 100`, and at 1 the self-dealing detector fires
   on a single entirely ordinary pair. And **`sessionEpoch` is refused outright**
   (`400 rejected_field`): revocation is `POST /auth/logout-all`, and a config
   field a client can set would let it *lower* the epoch and un-revoke what it
   had just cancelled.

x. **Recovery becomes a typed code, and the code is never consumed globally
   (SCOPE-DECISIONS §2.3, Phase 5).** The prototype mails a single-use **link**
   carrying a 128-bit token and `RecoveryService.redeem(code)` consumes it by
   value, wherever it came from. The server mails a **six-character Crockford
   code** the customer types on the device in their hand, over two public routes:
   `POST /recovery/request` (email in) and `POST /recovery/consume` (email +
   code in, identity cookie out). The change is not cosmetic — a short code
   cannot carry its own security, so `packages/server/src/recovery/codes.ts`
   checks a guess **against the card that asked for it**, counts wrong guesses in
   the `recovery_codes.attempts` column (durably: a restart does not buy five
   more), and supersedes an outstanding code when a new one is issued. This is
   the recovery twin of divergence **p**: the port's `createRecoveryCode` /
   `consumeRecoveryCode` keep working for the prototype and are given **no
   route**, enforced by a guardrail. Consequence for Phase 6: `RecoveryService`
   cannot survive the swap unchanged — `request` mints a code and sends mail
   client-side, and `redeem` now needs the address alongside the code — so it
   joins `getAlerts` (divergence **u**) as a service the composition root must
   point at a route. The screens' calls do not change shape.

y. **The server is the only sender of transactional mail (BACKEND-PLAN §3-C-13,
   Phase 5).** `EmailJsMailer` exposes its public key in the client bundle, so it
   is retired in the server build; `SmtpMailer` (nodemailer, `MAIL_SMTP_URL`)
   takes over, with `LogMailer` as the unconfigured fallback and a boot-time
   warning when there is none. The **welcome** and **reward-available** mails move
   with it — they are sent by `POST /customers` and `POST /customers/:id/commit`
   rather than by `CustomerService` and `LoyaltyService`, because the route is
   what knows a card was created or a reward minted. **Phase 6 must therefore
   wire the SPA with `NoopMailer` under `VITE_DATASTORE=api`**, or every mail
   goes out twice. The bodies also move into the repository
   (`packages/server/src/mail/templates.ts`) instead of living in an EmailJS
   dashboard, which retires divergence **b** for the server build.

z. **Transactional mail is sent after the response, not during it (Phase 5).**
   `background.ts` runs the send outside the request. For recovery this is a
   security property, not an optimisation: an awaited send makes a known address
   measurably slower than an unknown one, which is the enumeration oracle §2.3
   forbids — `POST /recovery/request` answers `202 {"status":"sent"}` before it
   has looked the address up at all. For the welcome and reward mails it is the
   prototype's own "best-effort, never blocks" rule, kept. The cost is that a
   send in flight when the process dies is lost; `installShutdownHandlers` drains
   before closing the pool, and a customer can always ask for another code.

aa. **The port asks for the plaintext, and says so (BACKEND-PLAN §4-A, Phase 6).**
   `setStaffPassword(id, passwordHash)` and `CreateStaffInput.passwordHash` were
   the most dangerous names in the codebase: no caller ever passed a hash, and a
   store that had written what the name described would have made the stored
   digest a working credential for anyone who could read the database. Both are
   now `password`. Nothing about the behaviour changed — Phases 2 and 3 already
   hashed server-side with argon2id and verified rather than compared — the
   signature simply stopped lying. `setStaffPin` was always honest.

ab. **`getStaffByPin` and `redeemReward` are off the port entirely (Phase 6).**
   Both were previously implemented-but-forbidden: `PostgresStore` had to carry
   them because the port demanded them, and `routes/guardrails.test.ts` kept
   callers away. The port no longer demands them, so the methods are gone. For
   `getStaffByPin` that upgrades divergence **p** from "a global PIN search must
   never get a route" to "there is no global PIN search"; the guardrail now fails
   if the identifier appears anywhere in the server at all. `redeemReward` was
   the pre-rework redeem path, already refused by migration 001's ledger
   vocabulary. **The SPA consequence is real:** `StaffService.loginWithPin` and
   `LoyaltyService.redeem` no longer compile — see `UI-RECONCILIATION.md` S1.

ac. **`DataStore` is what a client may ask for; `TrustedStore` is the rest
   (BACKEND-PLAN §4-C, Phase 6).** `appendAudit` takes a client-supplied actor
   and action, and the recovery-code methods take the customer whose codes are
   being played against — both are safe as in-process calls and hand a client
   exactly what the design withholds. They now live on `TrustedStore extends
   DataStore`, which `PostgresStore` implements and `AuthDeps.store` requires,
   so a client-side adapter cannot express them. The recovery pair also took the
   **scoped** shape (`createRecoveryCode(customerId)` →
   `consumeRecoveryCode(customerId, code)` → `recordFailedRecoveryAttempt`),
   which divergence **x** described as living only in `recovery/codes.ts`; the
   store delegates to that module, so there is one implementation rather than
   two. `POST /audit` still answers 204 and writes nothing, for the older client
   that calls it. **SPA consequence:** `AuditService.log` and both
   `RecoveryService` paths no longer compile.

ad. **`CommitResult` says whether it was replayed, and `Snapshot` carries rewards
   (Phase 6).** Two carried workarounds, both deleted. The commit route used to
   answer "is this a retry?" by reading `idempotency_keys` itself
   (`isCommitReplay`), because the port could not say — two simultaneous retries
   could both read "fresh" and write the audit rows twice. `CommitResult.ok` now
   carries `replayed`, stamped on the way out of the store's own cache read, and
   a guardrail keeps any second reader off that table. Separately `Snapshot`
   gained `rewards` and `rewardEvents` (version **6 → 7**): it predated
   rewards-as-objects, so a restore brought back the ledger and silently dropped
   every materialized reward. **Recovery codes are still not in a snapshot, and
   that part is a decision, not the same gap** — they expire fifteen minutes
   after they are issued, so every code in a restorable file is long dead, and
   carrying credential hashes in a file that travels to laptops is the thing
   `publicStaff` already blanks digests to avoid. A version-6 file still imports,
   minus those tables, rather than being refused.

## Pointers

- Architecture, diagrams, feature table → [`../README.md`](../README.md)
- Full spec → [`SPEC.md`](SPEC.md)
- Agent rules + subagent workflow → [`../CLAUDE.md`](../CLAUDE.md) and
  [`../.claude/agents/`](../.claude/agents/)
