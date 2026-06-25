# Collaboration notes — working with this maintainer & repo

> Persistent handoff for follow-up sessions. The maintainer clears context between
> tasks to save tokens, so this captures *how we work*, *what they prefer*, and the
> *operational gotchas* that have cost time. Pair with `docs/STATUS.md` (state) and
> `docs/REWARDS-PLAN.md` (the active build plan).

---

## 1 · The maintainer's preferences (observed)

- **Mocks before implementing.** For any UX/visual change, render **several labelled
  variants** and share them *before* writing code. They pick, then we build. They like
  to "double-check other variations" even after choosing.
- **Decisive recommendations, then momentum.** Give a clear recommendation (not an
  exhaustive survey), mark trade-offs, and move. They dislike process bloat — but for
  *large* changes they explicitly want a **comprehensive, error-free plan** with the
  conflicts/decisions surfaced up front (see how Appendix C/D was handled).
- **Ship to `main`.** They authorized pushing directly to `main` (overrides the designated
  feature branch). Commit + push when a unit of work is done and green. **No PRs unless asked.**
- **Always verify before claiming done:** `npx tsc --noEmit` + `npm test` + `npm run build`,
  then push with exponential-backoff retry. Keep `docs/STATUS.md` current every change (docs rule).
- **Device:** iPhone. They test on the deployed GitHub Pages site, often the **home-screen PWA**
  and **in-app browsers**. Design + debugging must account for iOS Safari/WKWebView quirks (§3).
- **Aesthetic taste (established this session):** warm café palette (forest/sage/blush/cream/terra,
  Fraunces/DM Sans/DM Mono); chose **dot-style QR**, **botanical wreath** redeem overlay (leaves +
  espresso beans + coffee-cherry cluster), **floating cream Find-us card** (24px radius), **A3 cup+count**
  reward badge. They reverted the continuity-scroll/gradient experiments — prefer **solid section colours +
  shaped handoffs** over gradient fades. "Small and boring beats clever."
- **Communication:** concise, plain, active voice. They appreciate honesty when something
  can't be done (e.g. iOS clipboard/localStorage limits) and a faithful report of failures.

## 2 · Persona / operating conventions (how the assistant works here)

- Act as orchestrator + implementer for this single-café loyalty prototype. Hold the
  **ports & adapters** discipline: UI → `services/` only; storage/transport/mailer/identity/wallet
  are swappable adapters; `domain/` is pure (no I/O); `DataStore` is **async everywhere**;
  ledger is **append-only**; **no PII in the QR or logs**; identity = 128-bit random token.
- **Visual verification loop:** use **puppeteer** (devDep) from the scratchpad to render mocks,
  QR codes, and final compositions to PNG, then send with `SendUserFile`. Launch headless with
  `args:['--no-sandbox']` (running as root). For node one-offs, write a `.cjs` (repo is ESM) and
  resolve deps from the repo root.
- **Commit trailers** (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: <the session URL from the harness>
  ```
- **Never** put the internal model identifier (the `claude-...[1m]` form) in any pushed artifact —
  chat only.
- Scratchpad for temp files: the session scratchpad dir (not `/tmp`, not the repo). Temp HTML/mocks
  go there; do not commit them unless asked.

## 3 · Operational gotchas (these cost real time — check them first)

- **Deploy:** GitHub Pages, auto on **push to `main`**. Pipeline runs **full `npm test` first** —
  a red test blocks the deploy. ~2–4 min end-to-end. **No service worker**; assets are content-hashed,
  so a fresh `index.html` pulls new code. Network from the sandbox **cannot reach `github.io`** (proxy 403)
  and the GitHub MCP tools come and go — can't read Actions runs or fetch the live site from here.
- **iOS Safari / WKWebView:**
  - `localStorage`/`indexedDB` on a downloaded `file://` page **throw `SecurityError`** — a JS read at
    load time blanks the whole page. Build offline HTML with **static content** + `try/catch` storage.
  - **In-app browsers** wipe their storage on close — page data does **not** survive a close. For
    review/handoff with the maintainer, prefer a **plain-text template they paste into Notes**, or "Open in Safari".
  - `window.confirm`/`window.prompt` are **suppressed** in standalone PWAs → use in-app confirms.
  - The translucent bottom toolbar shows content behind it; can't be made opaque from the web.
  - `indexedDB.deleteDatabase` can **hang silently**; a **blocked open** (site open in a 2nd context —
    background tab + home-screen PWA) hangs `openDB` forever → every DB call hangs. The store now
    **self-heals** (watchdog + delete-and-reopen + `blocking` handler) — keep it.
  - **Clipboard API + `execCommand('copy')` are unreliable** in in-app browsers (copy can no-op).
- **QR:** dot-style, drawn from the `qrcode` matrix as SVG (no new dep). Capacity is fine for the
  composite reward QR — full tokens to ~10 ids at a comfortable scan size (see REWARDS-PLAN §3.5).
- **Wallet passes** are **pre-generated on walletwallet.dev with fixed baked barcodes** — the app
  can't change them; the maintainer provisions their URLs. Keep the scanner backward-compatible.

## 4 · Repo orientation (where things live)
- `docs/STATUS.md` — current implementation state (read first). `docs/SPEC.md` — authoritative spec
  (do **not** edit; record divergences in STATUS). `README.md` — architecture + diagrams.
- `src/domain/` pure rules · `src/ports/` interfaces · `src/adapters/` implementations
  (`storage/IndexedDbStore.ts`, `sync/` device pairing RPC, `wallet/`, `transport/`) ·
  `src/services/` orchestration · `src/ui/` screens+components · `src/qr/` payloads+rendering.
- Subagents: `.claude/agents/` (orchestrator / explorer / implementer / reviewer / scribe).

## 5 · Session log (most recent first — what shipped & why)
- **Rewards rework planned** — Appendices C+D + multi-reward composite redemption analysed; all
  decisions locked; full build plan in `docs/REWARDS-PLAN.md`. **Not yet implemented.**
- **Botanical redeem overlay (V4)** — "Your free coffee" overlay = brand foliage wreath on cream,
  framing the QR. (Will switch card-QR → reward-QR in rewards Phase 6.)
- **Dot-style QR** everywhere (card/redeem/pairing), finder eyes kept as rounded squares.
- **Multi-reward badge (A3)** on the unlocked banner (cup + count, shows at 2+); tappable banner →
  redeem overlay. (Count source becomes `rewards.length` in Phase 6.)
- **IndexedDB self-heal** — fixed the "everything stuck 20s+" blocked-open hang (watchdog + delete/
  reopen + `blocking` handler); Reset hard-fallback; resilient dev diagnostic. +2 regression tests.
- **Floating Find-us card** — solid section colour + rounded cream card (replaced the gradient
  continuity-scroll experiment, which was reverted).
- Earlier: Crockford base32 customer short code + manual scan entry; admin stat breakdowns/trends;
  acknowledgeable alerts; counter-first routing; reset/pairing reliability fixes.
