# Brief B — Persisted transcript & mutation semantics

You are an independent parity auditor. Your launcher prompt assigned you a
track (codex or claude) and a single report file — write ONLY that file.

**Mission:** find user-visible divergences between current HEAD and Original
RisuAI at the fork point, introduced or exposed in the delta
`f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12), on this surface:
**the persisted chat transcript** — row identity and metadata (`chatId`,
`time`, `saying`, generated IDs, prompt info), ordering, send/append timing,
continue/regenerate/reroll/displacement semantics, multisend, and what ends
up durably stored after any user action.

## Ground rules

- The bar: `docs/audit/original-risu-compat-2026-08-12/CHARTER.md` — exact
  fork-point parity of user-visible behavior. Classify findings
  `candidate-fix` / `candidate-keep` / `decide`; final calls are the
  maintainer's.
- Baseline worktree: `/home/codex/risu-baseline-71c476e9c` (fork point
  `71c476e9c`). NEVER compare against `~/Risuai`.
- Do NOT re-report already-adjudicated divergences: the intentional section
  of `.archived-docs/audit/docs/orchestration-postgen.md` and every row of
  `docs/audit/original-risu-compat-2026-08-12/ADJUDICATION.md`. Report only
  NEW divergences, or evidence an adjudicated entry no longer matches code.
- Read-only everywhere except your one report file. Do not read any other
  file under `reports/`.
- Verify every claim in CURRENT code with `file:line` citations on both
  sides (current repo AND baseline worktree), plus a concrete repro
  scenario.

## Delta entry points (start here, then follow the code)

- `8c822bf35` browser atomic-send cutover + `d2df26e25` accepted-send
  coordinator routing — is the fork-point ordering (input trigger → append
  user row → `editinput` → run-vars) preserved for every send entry point?
  Any entry point that now appends earlier/later, or persists rows the
  original kept transient (or vice versa)?
- `8bf88e43c` continue disposition — in `append` mode, does the persisted
  outcome (new assistant row; say-nothing boundary transient) match the
  original `useSayNothing` flow exactly, including retry/cancel mid-continue?
- `53e59f420` PO multisend export exact-result requirement — does export
  content/shape still match what the original exported?
- Operation ledger integration (`43247b49e`, `09b70cc6f`) — do tombstones,
  abandoned operations, or recovery projections ever leave rows/metadata in
  the transcript that the fork point never wrote?
- `src/ts/process/index.svelte.ts`, `src/ts/process/request/serverChat.ts`,
  `server/fastify/src/routes/generationChat.ts` are the load-bearing files.

## Report format

Findings with IDs `B-1..n`; each: title, severity (high/med/low), current
behavior (file:line), baseline behavior (worktree file:line), user-visible
consequence + repro scenario, charter classification, confidence. End with:
areas swept and found clean (explicit), and anything you could not verify.
