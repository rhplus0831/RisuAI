# Brief C — Streaming & displayed-text semantics

You are an independent parity auditor. Your launcher prompt assigned you a
track (codex or claude) and a single report file — write ONLY that file.

**Mission:** find user-visible divergences between current HEAD and Original
RisuAI at the fork point, introduced or exposed in the delta
`f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12), on this surface:
**what the user sees during and after generation** — incremental streamed
text, post-processing of displayed text, stream completion/failure display,
and the relationship between displayed and persisted text.

## Ground rules

- The bar: `docs/audit/original-risu-compat-2026-08-12/CHARTER.md` — exact
  fork-point parity of user-visible behavior. Classify findings
  `candidate-fix` / `candidate-keep` / `decide`; final calls are the
  maintainer's.
- Baseline worktree: `/home/codex/risu-baseline-71c476e9c` (fork point
  `71c476e9c`). NEVER compare against `~/Risuai`.
- Do NOT re-report already-adjudicated divergences: the intentional sections
  of `.archived-docs/audit/docs/orchestration-postgen.md` /
  `provider-adapters.md` and every row of
  `docs/audit/original-risu-compat-2026-08-12/ADJUDICATION.md` (note
  CA-OR-3 already covers single-pass streaming `editoutput` — do not
  re-report it, but DO report new deltas layered on top of it).
- Read-only everywhere except your one report file. Do not read any other
  file under `reports/`.
- Verify every claim in CURRENT code with `file:line` citations on both
  sides (current repo AND baseline worktree), plus a concrete repro
  scenario.

## Delta entry points (start here, then follow the code)

- `ba5bd8be5` half-streaming mode (likely an upstream port — check
  `docs/upstream-sync/`; if so its reference is the upstream spec) — does
  enabling/disabling it change non-half-streaming behavior?
- `5a839b38a` replay budgets + compaction + `replay_gap` — after a
  reattach/replay, can the displayed text differ from what an
  uninterrupted fork-point session would have shown (dropped/duplicated
  spans, gap placeholders)?
- `f372c0ee6` `done.result` canonical after replay gaps — divergence between
  final displayed text and persisted text in any path?
- `8bf88e43c` — disposition carried through streaming: does `extend` mode
  stream-display match the fork point's continue display (text appended to
  the existing bubble vs a new bubble)?
- `src/ts/process/postGeneration/streamResponse.ts`,
  `src/ts/process/request/serverChatEvents.ts`, and the SSE consumer are
  load-bearing. Baseline comparison: the original's streamed-display update
  loop in `src/ts/process/index.svelte.ts` at the fork point.

## Report format

Findings with IDs `C-1..n`; each: title, severity (high/med/low), current
behavior (file:line), baseline behavior (worktree file:line), user-visible
consequence + repro scenario, charter classification, confidence. End with:
areas swept and found clean (explicit), and anything you could not verify.
