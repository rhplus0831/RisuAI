# Brief D — Generation lifecycle: Stop, cancel, retry, reattach

You are an independent parity auditor. Your launcher prompt assigned you a
track (codex or claude) and a single report file — write ONLY that file.

**Mission:** find user-visible divergences between current HEAD and Original
RisuAI at the fork point, introduced or exposed in the delta
`f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12), on this surface:
**lifecycle outcomes the user observes** — what Stop does to the transcript
and UI, retry behavior and confirmations, what a reload/restart leaves
behind, and reattach outcomes, compared to the fork point's
AbortController-based client-local lifecycle.

## Ground rules

- The bar: `docs/audit/original-risu-compat-2026-08-12/CHARTER.md` — exact
  fork-point parity of user-visible behavior. The durable operation
  protocol itself is out of scope (additive infrastructure); in scope is
  any place its OUTCOMES diverge from what the fork-point client left the
  user with (transcript content, retained/discarded text, retry prompts).
  Recovery abilities the fork point simply lacked (surviving a reload) are
  additive, not divergences — but their transcript side effects must still
  match what an uninterrupted or user-cancelled fork-point session produced.
- Baseline worktree: `/home/codex/risu-baseline-71c476e9c` (fork point
  `71c476e9c`). NEVER compare against `~/Risuai`.
- Do NOT re-report already-adjudicated divergences (notably CA-OR-3 cancel
  persists raw text, CA-OR-4 post-token failure restore — but DO report new
  deltas layered on them by the protocol waves):
  `.archived-docs/audit/docs/orchestration-postgen.md` intentional section +
  `docs/audit/original-risu-compat-2026-08-12/ADJUDICATION.md`.
- Read-only everywhere except your one report file. Do not read any other
  file under `reports/`.
- Verify every claim in CURRENT code with `file:line` citations on both
  sides (current repo AND baseline worktree), plus a concrete repro
  scenario.

## Delta entry points (start here, then follow the code)

- `0692762b9` acknowledged order-independent Stop — compare the end state
  after Stop at each phase (pre-token, mid-stream, during finalization)
  against the fork point's abort at the same phase: retained text, row
  presence, error display.
- `b14da1985` epoch-aware reattach + `e96a0f792` lifecycle matrix — do any
  reattach paths produce transcript/UI end states no fork-point session
  could produce (duplicated rows, replayed effects, resurrected cancelled
  text)?
- Restart marking operations `abandoned` + retry-confirmation for
  `providerMayHaveRun` — does any flow now require user interaction where
  the fork point silently proceeded, or vice versa?
- `6e72ecf49` reattach-failure UI, `317c0d2ea` completion barrier.
- `src/ts/process/reattach.ts`, `src/ts/server/generationOperations.ts`,
  `server/fastify/src/generationJobs.ts`, `streamJobs.ts` are load-bearing.

## Report format

Findings with IDs `D-1..n`; each: title, severity (high/med/low), current
behavior (file:line), baseline behavior (worktree file:line), user-visible
consequence + repro scenario, charter classification, confidence. End with:
areas swept and found clean (explicit), and anything you could not verify.
