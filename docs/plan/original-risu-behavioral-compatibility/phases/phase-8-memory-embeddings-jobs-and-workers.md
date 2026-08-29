# Phase 8 — Memory, Embeddings, Jobs, And Workers

Status: Complete
Depends on: Phases 1, 3, 5-7

Completion anchor:

- `a77f47c9f79b0233e147456e73ded69e1869d192` — closed retained-memory,
  embedding, BardWiki, queue, worker, and restart-recovery ownership.

## Objective

Verify retained memory selection, embeddings, summaries, context budgeting, and
background job/worker behavior across scheduling, execution, retry,
cancellation, restart, reconciliation, and model-visible consumption.

## Audit Questions

- Do memory candidates, ranking, thresholds, limits, ordering, and deduplication
  produce equivalent selected context?
- Do token/context truncation and summary placement preserve priority, role,
  boundaries, and model-visible content?
- Are embedding model/profile/options and legacy stored records interpreted
  consistently?
- Do jobs run once, retry with the right bounds, cancel safely, expose progress
  and errors, and reconcile after restart or response loss?
- Can stale work write into a deleted/replaced chat, character, or profile?

## Required Outputs

- Memory-selection and context-budget semantic fixtures.
- Job type/state/retry/cancel/reconciliation closed-world matrix.
- Deterministic queue, worker, stale-target, restart, and duplicate-delivery
  cases through real persistence where relevant.
- Model-visible integration assertions linked to Phase 6.
- Explicit classification of unsupported memory/worker modes.

## Exit Criteria

- Retained memory and summary inputs match observable baseline semantics or a
  signed decision.
- Jobs cannot silently duplicate, lose, or mis-target durable side effects.
- Every job type and terminal state has recovery, diagnostic, and test ownership.
- Focused memory/job, generation, persistence, and compatibility lanes pass.

## Validation

Run selection/budget fixtures, worker integration and fault tests, restart and
stale-target cases, affected and compatibility lanes, formatting, and
`git diff --check`.

## Completion Record

### Memory Selection And Model-Visible Consumption

`server/fastify/__tests__/phase8CompatibilityStructure.test.ts` closes the
retained standard Hypa planner, five retired memory algorithms, all 18 retained
`HypaModel` aliases, four allocation categories, three BardWiki modes, and nine
BardWiki score reasons over named production and behavioral owners. Server
embedding aliases resolve to custom, OpenAI-compatible, or Voyage contextual
providers; twelve local transformer aliases remain explicitly browser-owned.
Removed engines produce the existing migration notice instead of silently
behaving as maintained Hypa V3.

Selection/budget suites retain chunk ranges, source identity, ranking,
thresholds, category order, deduplication, token accounting, and prompt-row
placement. The added ratio regression proves invalid recent/similar ratios
clamp to 0/1 and report those applied values. Signed raw-system-row summaries,
deferred new summaries, invalid-ratio diagnostics, and conventional lore regex
parsing remain governed by `ORC-DECISION-054` through `056` and
`ORC-DECISION-031`; their current implementation/regression owners are now
corrected in the decision registry.

### Job And Worker Lifecycle

The structural gate closes all three memory job kinds, three BardWiki job kinds,
five queue states, terminal-state vocabularies, and every retry, exhaustion,
explicit retry, cancellation, restart, duplicate-delivery, stale-target,
reconciliation, and diagnostic owner. Memory `chunk` remains an explicit
reserved no-op because live chunk planning occurs during prompt assembly; embed
and summarize have concrete idempotent handlers.

Existing real-persistence suites already covered retry/exhaustion, cancellation,
stale chat invalidation, duplicate embed/summary delivery, BardWiki receipt
deduplication, restart, and reconciliation. The audit found one missing
assurance combination rather than a production defect: a job abandoned while
`running` across an actual database close/reopen and application start. The new
regression claims the persisted row, executes it once, records attempt count 2
and `completed`, closes the application, and verifies the same durable state
after reopening SQLite again.

### Closure And Boundaries

Category H rows `ORC-SURFACE-106` through `ORC-SURFACE-108` own retained-memory
selection/model-visible consumption, memory-worker durability, and BardWiki
jobs/reconciliation. Historical rows `ORC-SURFACE-035` and
`ORC-SURFACE-058` through `ORC-SURFACE-060` are independently re-verified at the
Phase 8 anchor. All seven Category H rows are verified with no mapped-only row.

No production fix, new finding, or new decision was required. Live model
downloads and embedding endpoints remain deterministic fixture boundaries;
browser-local engines remain client-owned. Phase 6 owns the final shared prompt
assembly, while Phase 12 owns common auth, limits, shutdown, and diagnostic
secrecy.

## Verification Evidence

| Check | Result |
| --- | --- |
| Changed-file selection over structure, worker, budget allocator, and lorebook | Passed; 4 files and 112 tests. |
| Full memory/BardWiki/assembly/lorebook owning lane | Passed; 37 files and 563 tests. |
| Command and generation persistence integration | Passed; 2 files and 411 tests. |
| Retired-memory browser assurance | Passed; 1 file and 3 tests. |
| `pnpm check:server` | Passed after the Phase 8 structural test. |
| Register, compatibility, formatting, and diff gates | Required after the Category H register update; exact final counts are recorded in `latest-verification.md`. |
