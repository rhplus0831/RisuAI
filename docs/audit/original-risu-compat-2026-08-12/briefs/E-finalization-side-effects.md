# Brief E — Finalization order & script/lore/memory side effects

You are an independent parity auditor. Your launcher prompt assigned you a
track (codex or claude) and a single report file — write ONLY that file.

**Mission:** find user-visible divergences between current HEAD and Original
RisuAI at the fork point, introduced or exposed in the delta
`f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12), on this surface:
**post-generation side effects** — the finalization order (`editoutput` →
insertion/extension → run-vars → output trigger → persistence), chat
variables, script-driven lore writes, Hypa memory state, and whether every
side effect the fork point applied still lands exactly once with the same
values.

## Ground rules

- The bar: `docs/audit/original-risu-compat-2026-08-12/CHARTER.md` — exact
  fork-point parity of user-visible behavior. Classify findings
  `candidate-fix` / `candidate-keep` / `decide`; final calls are the
  maintainer's.
- Baseline worktree: `/home/codex/risu-baseline-71c476e9c` (fork point
  `71c476e9c`). NEVER compare against `~/Risuai`.
- Do NOT re-report already-adjudicated divergences: the intentional sections
  of `.archived-docs/audit/docs/scripts-triggers-lua.md` /
  `lorebook-memory.md` / `orchestration-postgen.md` and every row of
  `docs/audit/original-risu-compat-2026-08-12/ADJUDICATION.md` (CA-ST-1/2
  V2 no-ops and CA-ST-5 Lua VM isolation are settled — report only NEW
  deltas).
- Read-only everywhere except your one report file. Do not read any other
  file under `reports/`.
- Verify every claim in CURRENT code with `file:line` citations on both
  sides (current repo AND baseline worktree), plus a concrete repro
  scenario.

## Delta entry points (start here, then follow the code)

- `4abc6d1c0` phase-aware finalization journal + `ce78d75d2` queue
  projection — can journaled/queued finalization reorder or drop side
  effects relative to the fork point's synchronous order? What does the
  user see while queued?
- `1dd9f9123` generation-effect ledger (durable effects replay exactly-once
  on late recovery; ephemeral effects live-terminal-only) — which effects
  got classified "ephemeral", and did any of them mutate durable state at
  the fork point (i.e., are now silently dropped on recovery)?
- Assembly-persist fencing (`f4356c498`, pre-delta but interacting) — the
  `stale_generation_script_mutations` drop path: enumerate what can now be
  dropped that the fork point always applied.
- `ecf470b04` Hypa V3 instance-keyed projections + cancel abort — stored
  summary parity for the same chat history.
- `ce5d74b18` / `492f99e9e` Lua durable lore/character writes — value and
  ordering parity with fork-point script writes.
- `67210c623` trigger/CBS explicitness — warnings must be additive; confirm
  no behavior change rode along.
- `server/fastify/src/prompt/assemble.ts` (finalization),
  `generationJobs.ts`, `src/ts/process/index.svelte.ts` finalize path.

## Report format

Findings with IDs `E-1..n`; each: title, severity (high/med/low), current
behavior (file:line), baseline behavior (worktree file:line), user-visible
consequence + repro scenario, charter classification, confidence. End with:
areas swept and found clean (explicit), and anything you could not verify.
