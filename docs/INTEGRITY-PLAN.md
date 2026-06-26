# Staff integrity & observability — build plan (Appendix E)

> **Active initiative.** Reshapes how staff/admin actions are *surfaced, reached, and
> corrected* — collection is unchanged; presentation changes. One line: **the system
> remembers everything, judges almost nothing, and announces the little it judges.**
> **Supersedes** the SPEC §6 audit-log surfacing, the §8.7 activity views, and the
> rewards-as-objects **5-second post-commit undo** (redesigned here as a *pre*-commit hold).
> Appendix E text was provided in-session; the actionable distillation below is sufficient to build.

---

## 0 · HOW TO USE THIS ACROSS SESSIONS (read first)

Written so work can continue **with context cleared between tasks**. Each phase is an
**independently executable task** with explicit inputs, files, and done-criteria.

**Resume protocol for a new session:**
1. Read `docs/STATUS.md` (current state) and this file.
2. Find the first **unchecked** box in the *Progress* checklist — that's the next task.
3. Do **only that phase**. Stay within its file list. Honour `../CLAUDE.md`'s architecture rules.
4. Before committing: `npx tsc --noEmit` + `npm test` + `npm run build` must all pass.
5. Tick the box here, refresh the `STATUS.md` "Last updated" line, commit + push to the working branch.
6. Stop. The next session picks up the next box.

---

## 1 · Progress checklist

- [ ] **Phase 0** — Staff Scan: 3-second deferred (pre-)commit
- [ ] **Phase 1** — Remove the old post-commit undo machinery
- [ ] **Phase 2** — Detectors: prune to two + rebuild self-dealing + configurable thresholds
- [ ] **Phase 3** — Activity surfacing: staff terminal · admin home · StatDetail · per-account
- [ ] **Phase 4** — Investigation & export workflow (filter → reason → JSON)
- [ ] **Phase 5** — Docs (STATUS divergences + acceptance rows)

Phase 0 must land **before** Phase 1 (the UI stops calling `undo` first, then the dead code is removed).
Phases 2–4 are independent of each other and of 0/1.

---

## 2 · Locked decisions (settled with the maintainer)

| # | Decision |
|---|---|
| **Undo → pre-commit hold** | The 5-second *post-commit* undo is **replaced** by a **3-second pre-commit hold**. Nothing is written until the window elapses. **No store/commit-contract change** — the deferral is **purely client-side** in the staff Scan UI. Errors are caught in the first seconds; a held-but-not-submitted transaction can never be a misusable "reverse an already-committed transaction." |
| **Hold UX** | The countdown screen **doubles as the confirmation + cancel** ("here's what's about to commit"), then **auto-advances to the scanner** (fresh scan per customer). **Cancel** discards (nothing written). **Commit now** submits before the 3 s elapses. |
| **Remove old undo** | Delete `undoCommit` / `LoyaltyService.undo` / `domain/rewards.ts planUndo` / its sync allow-list entry / the C9·D10 undo acceptance rows. **Keep `LoyaltyService.reverse`** (the §6 correction primitive) and **keep the `idempotencyKeys` store** (commit dedup / RPC-retry safety). |
| **Detectors** | Keep exactly **two**: **self-dealing proximity** (rebuilt against the real redemption source — the dead `type==='redemption'` ledger match is gone) and **repeat-target**. **Drop** velocity, outlier-share, oversized-multi-add, off-hours. |
| **Detector config** | Detector thresholds are **editable in the admin Configure panel** (proximity window + count, repeat-target window + count). Defaults: redeem within **~30 s** of an accrual, same staff + same card, flag at **≥3** occurrences; repeat-target **>3** credits in **30 min**. |
| **Uniform / non-blocking** | Detectors apply to **admins too** (no role exemption — already true). Flags **surface, never block**. |
| **Disclosure to staff** | E3's "posted tripwire" staff-facing disclosure is **deferred** — add later. |
| **Staff terminal recent view** | **Recent-and-local**: scoped to the **signed-in actor + last hour**, hard-capped at ~10, **no "Load all"** (the bound *is* the safeguard). **No device ID** plumbed now — true per-terminal scoping is inherited at the imminent production move (each device is its own identity). |
| **Admin home** | **Delete** the ambient cross-account Activity feed. Keep shop-level stat tiles. |
| **StatDetail** | **Total + chart only** — drop the attributed per-action `EntryList` (it was an ambient feed by a side door). |
| **Per-account drill-down** | **Removed** as a casual view: `AccountSheet` keeps enable/disable/reset/delete; its **activity-history list is removed**. Account history is reachable **only** via the export workflow. |
| **Export** | Blank-by-default filter (time range, action type(s), account(s) **incl. admins**) + **required reason** → produces a **JSON file** download. The export **is itself audited**; **past exports are listed** in the export view (re-runnable; a re-run is a new audited export). |
| **Notify-on-export** | **Dropped entirely** — there is no staff notification channel and none is being added. |
| **Retention** | **Skipped for now** — keep **all** data, unbounded. This also sidesteps the ledger-balance trap (no pruning ⇒ no balance-derivation risk). Revisit later with compaction. |
| **Geofence / out-of-hours lock** | **Not built.** |

---

## 3 · Contracts & changes (lock before any phase)

### 3.1 Pre-commit hold (Phase 0) — `ui/screens/staff/Scan/*`
- **No service/store/domain change.** Today the Scan calls `loyalty.commit` immediately, then shows a
  `committed` sub-state with a 5 s **Undo** (`loyalty.undo`). Replace that with:
  - On the counter panel's submit: enter a **`pending`** sub-state — a 3-second blocking countdown that
    summarizes the staged action (points to add · rewards to redeem · "will earn N free" computed
    client-side via `domain/rewards.ts mintFold`, since nothing is committed yet), with **Cancel** and
    **Commit now**.
  - On timeout **or** Commit now → call `loyalty.commit` **once** (fresh `idempotencyKey`) → on success,
    **auto-advance to the scanner** (a brief "Added 1 · redeemed 1" toast is fine). On `over_cap` → the
    existing per-scan-limit error.
  - On Cancel → discard the staged transaction (nothing written) → return to the counter panel.
  - **Delete** the `committed`+Undo sub-state and every `loyalty.undo` call site.

### 3.2 Remove old undo (Phase 1)
- `ports/DataStore.ts` — drop `undoCommit`. `adapters/storage/ApiStore.ts` — drop the stub.
- `adapters/storage/IndexedDbStore.ts` — drop the `undoCommit` impl and any `undo_reissue` / `mint_reversed`
  paths **not** shared with `reverse`. **Verify `LoyaltyService.reverse` does not depend on `planUndo`** before deleting it.
- `domain/rewards.ts` — drop `planUndo` + its tests.
- `services/LoyaltyService.ts` — drop `undo`.
- `adapters/sync/storeMethods.ts` — drop `undoCommit` from the allow-list.
- **Keep:** `reverse`, the `idempotencyKeys` store, the `reward.voided` event type (still used by `reverse`).

### 3.3 Detectors (Phase 2) — `domain/alerts.ts`, `services/LoyaltyService.ts`, `ProgramConfig`
- `AlertKind` shrinks to `'self-dealing' | 'repeat-target'`. Delete the other four detector functions,
  their union members, and their unused threshold fields.
- **Self-dealing proximity rebuild.** The ledger no longer carries `redemption`. Source redemptions from the
  **`loyalty.redeem` audit rows** (uniform `actorId`+`targetId`+`timestamp`, already used by `getStats`) and
  accruals from `loyalty.accrue` audit rows (or ledger `accrual`). The service assembles a unified attributed
  event list `{ staffId, customerId, at, kind: 'accrue' | 'redeem' }[]` and passes it to the **pure** detector;
  the detector flags an `accrue`→`redeem` pair by the same staff on the same card within the window, **repeated ≥ count**.
  *(Alternative source = `rewards` where `status==='spent'` (`spentByStaffId`/`spentAt`) — confirm preference if revisited; audit rows are simplest and uniform.)*
- **Repeat-target** stays as-is (ledger accruals, same staff + same card, > count in window).
- **Config fields** on `ProgramConfig`: `selfDealWindowSec`, `selfDealCount`, `repeatWindowMin`, `repeatCount`
  (seed the defaults above). `getAlerts()` reads them from config instead of `DEFAULT_THRESHOLDS`.
- No role exemption. Monitoring only. `AlertDetail` `KIND_LABEL` pruned to the two kinds.

### 3.4 Activity surfacing (Phase 3)
- **Staff terminal recent list** → `audit.list({ actorId: <session staff id>, since: now-1h })`, cap ~10, **no pager / no Load all**.
  Needs `AuditFilter` time support (see 3.5) or an in-memory `since` filter. Actor+time scope means a logout/login still shows "this staff's last hour."
- **Admin home** (`Admin.tsx`) — remove the ambient `Activity` `Feed` section entirely; keep the stat tiles + alerts.
- **StatDetail** (`StatDetail.tsx`) — render total + chart only; remove `<EntryList>` and its pager.
- **AccountSheet** — remove the per-account activity-history section; keep the management actions.

### 3.5 Investigation & export (Phase 4)
- `ports/DataStore.ts` — extend `AuditFilter`: `{ action? | actions?: AuditAction[]; actorId? | actorIds?: string[]; from?: ISO; to?: ISO; limit? }`.
  `IndexedDbStore.listAudit` should honour the range (use the existing unused `byTimestamp` index).
- `domain/models.ts` — `AuditAction` gains **`audit.export`** (the export is an audited event).
- New service method (e.g. `AuditService.exportActivity(actor, filter, reason)`): runs the query, **writes an
  `audit.export` row** (`actorId` = admin, `details = { from, to, actions, accounts, reason }`), returns the rows.
- New admin part (e.g. `_parts/Export/`): **blank-by-default** form — time range, action type(s), account(s)
  **including admins**, **required reason** (submit disabled until present) → on run, serialize the result to a
  **JSON file** (Blob + anchor download). **Past exports** = `audit.list({ action: 'audit.export' })`, listed in the
  view, tappable to **re-run** (re-apply the stored filter — itself a new audited export).
- Admin-only. Not step-up gated (consistent with E5 / the other per-profile admin actions).

---

## 4 · Phases (each = one task)

### Phase 0 — Staff Scan: 3-second deferred commit
- **Files:** `ui/screens/staff/Scan/*` (+ `_parts/ScanView` etc.).
- **Do:** §3.1. Stage → 3 s blocking countdown (Cancel · Commit now) → commit once → auto-advance to scanner. Remove the post-commit `committed`+Undo state and all `loyalty.undo` calls.
- **Done when:** commit deferred 3 s; Cancel writes nothing; Commit now works; auto-advances to scanner; component tests green.

### Phase 1 — Remove old post-commit undo
- **Files:** `ports/DataStore.ts`, `adapters/storage/ApiStore.ts`, `adapters/storage/IndexedDbStore.ts`, `domain/rewards.ts`, `services/LoyaltyService.ts`, `adapters/sync/storeMethods.ts`, affected tests.
- **Do:** §3.2. Delete `undoCommit`/`undo`/`planUndo` + sync entry + tests. Keep `reverse`, `idempotencyKeys`. Verify `reverse` is independent of `planUndo` first.
- **Done when:** no `undo*`/`planUndo` references remain; `reverse` still works; tsc + tests + build green.

### Phase 2 — Detectors: prune + rebuild self-dealing + configurable
- **Files:** `domain/alerts.ts`, `services/LoyaltyService.ts`, `ports/DataStore.ts` (`ProgramConfig`), `adapters/storage/*` (seed defaults), `ui/screens/admin/_parts/ProgramEdit/*` + the Configure panel, `ui/screens/admin/_parts/AlertDetail/*`, tests.
- **Do:** §3.3. Two detectors only; self-dealing fed from `loyalty.accrue` + `loyalty.redeem` audit rows; thresholds from config + editable in admin; admins not exempt.
- **Done when:** only `self-dealing` + `repeat-target` fire; self-dealing fires on a real reward redemption (regression: the old detector fired on nothing post-rework); thresholds editable; tests green.

### Phase 3 — Activity surfacing redesign
- **Files:** staff recent-list owner (`ui/screens/staff/Panel/*` / `_parts/TopBar` today-list), `ui/screens/admin/Admin/Admin.tsx`, `ui/screens/admin/_parts/StatDetail/StatDetail.tsx`, `ui/screens/admin/_parts/AccountSheet/*`, `ports/DataStore.ts` + `IndexedDbStore.listAudit` (time filter), tests.
- **Do:** §3.4. Staff recent = actor + last hour ≤10, no Load-all. Delete admin ambient feed. StatDetail chart-only. AccountSheet loses its history list.
- **Done when:** staff sees only own ≤10/last-hour with no Load-all; admin home has no per-action feed; StatDetail has no per-action list; AccountSheet has no history; tests green.

### Phase 4 — Investigation & export
- **Files:** `ports/DataStore.ts` (`AuditFilter`), `adapters/storage/IndexedDbStore.ts` (range query via `byTimestamp`), `adapters/storage/ApiStore.ts`, `domain/models.ts` (`audit.export`), `services/` (export method), new `ui/screens/admin/_parts/Export/*`, `ui/screens/admin/Admin/Admin.tsx` (entry point), tests.
- **Do:** §3.5. Blank form (range · actions · accounts incl. admins · required reason) → JSON download; audited `audit.export`; past-exports list (re-runnable).
- **Done when:** form opens blank; reason required; JSON downloads; export is audited; past exports listed + re-run; accounts include admins; tests green.

### Phase 5 — Docs
- **Files:** `docs/STATUS.md`, this file (tick boxes), `README.md` if a diagram changes.
- **Do:** record that Appendix E supersedes the prior alert acceptance row + §8.7 activity views, and that the rewards 5 s **post-commit undo** is replaced by the 3 s **pre-commit hold** (update/retire the C9·D10 undo rows). Record the **deferred** items: staff disclosure surface, notify-on-export, retention, device-ID per-terminal scoping, geofence. Cannot edit `docs/SPEC.md` — record divergences in STATUS.

---

## 5 · Acceptance (E9 → tests)

| Criterion | Test / check |
|---|---|
| Transaction is held 3 s before any write; Cancel writes nothing | Scan: cancel during countdown → store unchanged; timeout/Commit-now → one commit |
| Terminal returns to **idle/scanner** after each commit (fresh scan per customer) | Scan: post-commit state = scanner, no persistent card link |
| No post-commit reversal path exists | `undo`/`undoCommit`/`planUndo` removed; `reverse` retained |
| Exactly two detectors, both attributed, admins included, surfaced-not-blocking | `alerts.test.ts`: only `self-dealing` + `repeat-target`; admin actor flagged; nothing blocks |
| Self-dealing fires on a real redemption (not the dead ledger type) | detector over `loyalty.accrue`+`loyalty.redeem` audit events |
| Detector thresholds editable via admin Configure | ProgramConfig fields + Configure panel test |
| Staff terminal shows only recent-and-local (≤10 / 1h, own actions), never full history, no Load-all | staff recent-list test |
| Admin home = shop-level only; no ambient cross-account feed; no casual per-account history | Admin.tsx + StatDetail + AccountSheet tests |
| Cross-account activity only via export: blank form, required reason, audited, accounts incl. admins | Export flow test + `audit.export` row written |
| Export produces a JSON file; past exports listed + re-runnable | Export view test |
| All data retained (no retention window); balance derivation unaffected | by design — no pruning |

---

## 6 · Risk & sequencing notes
- **Phase 0 before Phase 1.** The Scan UI must stop calling `loyalty.undo` before the undo code is deleted, or the build breaks mid-phase.
- **`reverse` vs `planUndo`.** Confirm `LoyaltyService.reverse` (§6 corrections, still wanted) shares no code with `planUndo` before deleting it. Keep `reward.voided`.
- **Self-dealing source of truth.** Fed from `loyalty.redeem`/`loyalty.accrue` **audit** rows (uniform attribution + timestamp, already queried by `getStats`). The dead `type==='redemption'` ledger match is the bug being fixed — do not reintroduce it. (`rewards.status==='spent'` is the strict alternative if ever preferred.)
- **All-time stats + no retention.** With retention skipped, audit-derived all-time metrics stay complete — no truncation concern for now. Re-examine when retention + ledger compaction are eventually built.
- **Inherited at production move (do not build now):** device-ID per-terminal scoping, retention/compaction, staff disclosure surface, notify-on-export, geofence. All are documented-deferred, not dropped.
- **Supersedes shipped work:** the rewards-as-objects 5 s post-commit undo (REWARDS-PLAN Phases 1–8) is intentionally redesigned here; those files and acceptance rows change.
