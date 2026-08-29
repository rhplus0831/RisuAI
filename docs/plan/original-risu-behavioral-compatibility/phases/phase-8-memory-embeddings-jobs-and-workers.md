# Phase 8 — Memory, Embeddings, Jobs, And Workers

Status: Pending  
Depends on: Phases 1, 3, 5-7

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
