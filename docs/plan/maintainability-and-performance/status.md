# Maintainability and Performance Status

Updated: 2026-09-05

## Execution Cursor

- State: planned; implementation has not started.
- Opening source: `2a1abfbf937895d598b92dfd3724ef6a501dd7fd`.
- Next phase: [0. Character creation safety](phases/phase-0-character-creation-safety.md).
- Next task: reproduce F01 in a repository regression test using the two normal
  creation endpoints and an unrelated chat with BardWiki data; then replace the
  broad creation writes with targeted writes and verify preservation.
- Blockers: none for starting Phase 0. Missing production timing data does not
  block the correctness fix.
- Implementation commit: none. The documentation change is not a fix for F01.

Read [PLAN.md](PLAN.md) for stable scope, evidence, and invariants; read only the
selected [phase](phases/README.md) for implementation detail.

## Phase Router

| Phase | Findings | State | Accepted implementation/evidence |
| --- | --- | --- | --- |
| [0. Character creation safety](phases/phase-0-character-creation-safety.md) | F01 | Ready; not started | None |
| [1. Baselines and budgets](phases/phase-1-baselines-and-budgets.md) | F02–F10 | Pending Phase 0 | None |
| [2. Browser work](phases/phase-2-browser-work.md) | F03, F05, F04, F06 | Pending Phase 1 | None |
| [3. Generation inputs and types](phases/phase-3-generation-inputs-and-types.md) | F02, F09 | Pending Phase 2 | None |
| [4. Server maintenance](phases/phase-4-server-maintenance.md) | F07 | Pending Phase 3 | None |
| [5. Transcript residency](phases/phase-5-transcript-residency.md) | F08 | Pending Phase 4; implementation decision open | None |
| [6. Shared policy and closeout](phases/phase-6-shared-policy-and-closeout.md) | F10; all closeout evidence | Pending prior phases | None |

## Finding Dispositions

| Finding | Disposition | Missing completion evidence |
| --- | --- | --- |
| F01 | Open; reproduced data loss | Regression test, targeted fix, unrelated-row preservation |
| F02 | Open; source-confirmed work | Preparation baseline, narrowed reads/clones, behavior parity |
| F03 | Open; source-confirmed work | Scoped rollback and clone-scope proof |
| F04 | Open; source-confirmed work | Resource progress independent of pruning; cache lifecycle proof |
| F05 | Open; source-confirmed work | Single-normalization proof and durable-intent parity |
| F06 | Open; measured bundle cost | Selected-locale loading and fresh preload comparison |
| F07 | Open; source-confirmed work | Stall baseline, API progress, backup/GC consistency |
| F08 | Open; measurement required | Residency baseline and recorded implementation/retention decision |
| F09 | Open; source-confirmed type gap | Explicit prompt views and compiler-enforced boundary coverage |
| F10 | Open; source-confirmed duplication | Shared owner and unchanged consumer behavior |

## Verification Ledger

Distinguish audit observations, documentation checks, and implementation gates.
Do not carry an opening pass forward as proof of a later implementation commit.

| Scope | Source/date | Evidence | Limitation |
| --- | --- | --- | --- |
| Opening audit | Opening source, 2026-09-05 | Eight research areas cross-checked against source; both character creation endpoints reproduced BardWiki deletion in disposable SQLite fixtures. | Temporary reproductions are not checked-in regression tests; no production data inspected. |
| Opening preload | Opening source, 2026-09-05 | `pnpm build:initial-preload` passed; 389,721 total gzip bytes, 291,801 language gzip bytes. | Build sizes are not browser latency measurements or total post-startup transfer. |
| Plan review | Current documentation worktree, 2026-09-05 | Two read-only reviews completed; clarified cache-generation fences, nested prompt types, backup pins, and full-transcript screenshot exceptions. | Review of proposed work; no implementation evidence. |
| Plan documents | Opening source plus plan documents, 2026-09-05 | Explicit link/path validation passed for all 11 plan/index documents; `pnpm check:docs` passed for 49 current documents; whitespace checks passed. | Does not close implementation findings. |
| Agent aggregate | Opening source plus plan documents, 2026-09-05 | `pnpm test:agent` passed in 2m 16s: server/browser-smoke types, topology, current docs, frontend tests/check, server tests, and smoke build. | Excludes Playwright, specialized performance, and user/CI compatibility lanes; the new F01 regression is still future work. |

For each implemented slice add its source commit, fixture/reproduction, exact
commands and results, before/after cost, changed contract if any, and residual
risk. If evidence fails, record the failure and next action instead of advancing
the phase. Keep long generated logs outside this document; preserve the facts
needed to reproduce them here or in the owning phase's bounded slice record.

## Decisions and Exceptions

- The ten audited findings are the initial scope. No implementation has been
  deferred, accepted as fixed, or added beyond that scope.
- Phase 0 precedes broad benchmarking because F01 is a reproduced correctness
  failure. Performance measurement must not delay its repair.
- F08 retains an implementation decision gate. A measured decision to keep
  paging must record its supported fixture envelope and revisit trigger.
- The single-writer model, durable outbox, revision/event ordering, and existing
  shared-package boundaries remain invariants, not optimization targets.

Future amendments belong here with date, affected finding, evidence, owner,
residual cost, and revisit condition. If an amendment changes stable scope or
phase dependencies, update `PLAN.md` and the affected phase at the same time.
