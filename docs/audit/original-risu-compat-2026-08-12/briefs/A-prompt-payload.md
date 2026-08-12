# Brief A — Prompt assembly & request payload

You are an independent parity auditor. Your launcher prompt assigned you a
track (codex or claude) and a single report file — write ONLY that file.

**Mission:** find user-visible divergences between current HEAD and Original
RisuAI at the fork point, introduced or exposed in the delta
`f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12), on this surface:
**the assembled prompt and outgoing request payload** — prompt text, message
ordering, roles, trimming/truncation, CBS evaluation affecting the payload,
sampler parameters.

## Ground rules

- The bar: `docs/audit/original-risu-compat-2026-08-12/CHARTER.md` — exact
  fork-point parity of user-visible behavior. Classify findings
  `candidate-fix` / `candidate-keep` / `decide`; final calls are the
  maintainer's.
- Baseline worktree: `/home/codex/risu-baseline-71c476e9c` (fork point
  `71c476e9c`). NEVER compare against `~/Risuai`.
- Do NOT re-report already-adjudicated divergences: the intentional sections
  of `.archived-docs/audit/docs/prompt-assembly.md`,
  `history-cbs-variables.md`, `lorebook-memory.md`, and every row of
  `docs/audit/original-risu-compat-2026-08-12/ADJUDICATION.md`. Report only
  NEW divergences, or evidence that an adjudicated entry's description no
  longer matches current code.
- If a behavior comes from a post-fork upstream port (check
  `docs/upstream-sync/`), its reference is the ported spec, not the fork
  point — note it, don't grade it against the fork point.
- Read-only everywhere except your one report file. Do not read any other
  file under `reports/`.
- Verify every claim in CURRENT code with `file:line` citations on both
  sides (current repo AND baseline worktree). Every finding needs a concrete
  reproduction scenario (settings + chat state + action → divergent output).

## Delta entry points (start here, then follow the code)

- `656be4b1e` context-truncation confirmation — does the confirm flow change
  which messages get trimmed vs the fork point's silent trim?
- `f6df8cb1e` CBS evaluated before lorebook token counting — does the eval
  order change lorebook activation or cutoff boundaries for the same input?
- `6c361e00e` role selection for prompt-template blocks (likely an upstream
  port — check the sweep ledger) — does it leak role changes into templates
  that never opted in?
- `8bf88e43c` continue disposition — in `extend` mode, does continue history
  construction still match the fork point exactly? Does the transient
  boundary row leak into any payload where the fork point had none?
- The protocol waves (`43247b49e`..`b14da1985`) — did threading operation
  state through assembly (`server/fastify/src/prompt/assemble.ts`,
  `staticSections.ts`, `promptScope.ts`) perturb payload construction?

## Report format

Findings with IDs `A-1..n`; each: title, severity (high/med/low), current
behavior (file:line), baseline behavior (worktree file:line), user-visible
consequence + repro scenario, charter classification, confidence. End with:
areas swept and found clean (explicit), and anything you could not verify.
