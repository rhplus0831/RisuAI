# Frontend Test Architecture Status

Date: 2026-08-28

This is the live router for the frontend test runtime architecture workstream.
Use it first, then open only the active phase or slice. The current runner and
codebase remain authoritative until a phase lands.

## Current Snapshot

- Plan state: Drafted and ready for Phase 0 implementation.
- Current phase: Phase 0 — Baseline And Classification.
- Active slice: Formal baseline, capability taxonomy, and exhaustive/disjoint
  discovery proof.
- Implementation state: Not started.
- Blockers: None.
- Next action: Produce the Phase 0 inventory and benchmark record without
  changing project ownership.

## Phase Router

| Phase | State | Purpose |
| --- | --- | --- |
| [0](phases/phase-0-baseline-and-classification.md) | Ready | Ratify metrics, capability rules, and discovery/completeness proof. |
| [1](phases/phase-1-runtime-topology.md) | Pending | Add and pilot the Node, Svelte+Node, and Happy-DOM topology. |
| [2](phases/phase-2-pure-node-promotion.md) | Pending | Promote already-pure tests to Node in bounded domain slices. |
| [3](phases/phase-3-svelte-node-promotion.md) | Pending | Promote Svelte-compiled tests that do not require DOM behavior. |
| [4](phases/phase-4-pure-logic-extraction.md) | Pending | Extract measured pure-logic seams while retaining DOM contracts. |
| [5](phases/phase-5-dom-contract-consolidation.md) | Pending | Consolidate repeated DOM setup and clarify visible-state ownership. |
| [6](phases/phase-6-routing-and-ci-enforcement.md) | Pending | Enforce explicit routing and align affected tests, coverage, aggregate execution, and CI. |
| [7](phases/phase-7-verification-and-closeout.md) | Pending | Prove final budgets and behavior, update current docs, and archive the workstream. |

## Provisional Baseline

These values are planning evidence from 2026-08-28, not the formal Phase 0
three-run baseline.

| Measurement | Result |
| --- | ---: |
| Ordinary frontend files | 528 passed |
| Ordinary frontend tests | 6,408 passed |
| Frontend lane inside `test:all` | 80.11s Vitest / 81.1s lane |
| Standalone ordinary frontend wall time | 75.13s |
| Standalone peak RSS | 4,822,384 KiB |
| Node project | 124 files / 766 tests / 3.92s wall |
| Happy-DOM project | 404 files / 5,642 tests |
| Aggregate transform | 129.94s |
| Aggregate setup | 31.05s |
| Aggregate import | 485.51s |
| Aggregate test bodies | 88.89s |
| Aggregate environment | 60.69s |
| Full `test:all` wall time | 210.11s |
| Focused UI coverage lane | 19.15s Vitest / 20.0s lane |

The planning profile also found 407 files under 100 ms of test-body time and
280 under 25 ms. Phase 0 must reproduce and formalize these values.

## Current Decisions

1. Use a phased plan with status and verification routers.
2. Preserve per-file isolation by default; global `--no-isolate` is rejected by
   observed mock/state leakage and unintended test-host DNS attempts.
3. Target three frontend capability layers: Node, Svelte+Node, and
   Svelte+Happy-DOM, with Playwright retaining real-browser contracts.
4. Do not use production logic extraction until current profiling identifies a
   useful seam, and keep a DOM contract for visible behavior.
5. Reassess Phase 4 breadth after Phases 1-3. Meeting the primary target early
   narrows later extraction scope.
6. Treat aggregate `test:all` wall time, correctness, stability, and memory as
   co-equal with the displayed frontend lane duration.

## Open Phase 0 Decisions

- Ratify suffix routing versus a generated capability manifest, including the
  transition mechanism for legacy filenames.
- Define the exact Svelte+Node setup boundary and which shared setup belongs in
  every project.
- Ratify formal median/range measurement commands and final numeric budgets.
- Choose the first representative pilot files for each capability class.
- Define the durable completeness artifact and how CI proves no file is omitted
  or multiply assigned.

## Latest Completed Slice

None. Planning documentation is drafted; no runtime or test ownership changes
have landed.

## Latest Verification

See [`latest-verification.md`](latest-verification.md) for the provisional
pre-plan timing and correctness record. Phase 0 must replace it with the formal
baseline before Phase 1 begins.

## Maintenance Rules

- Update this file whenever a phase or slice changes state.
- Keep this file a router, not a chronological implementation diary.
- Put stable scope and invariants in `plan.md`.
- Put phase scope and exit criteria under `phases/`.
- Add concrete implementation/proof slices under `phases/slices/<phase>/` only
  when that phase is prepared for execution.
- Record exact commands and results in `latest-verification.md`.
- Record deferrals with an owner, reason, and revisit condition.
- Do not mark a phase complete until its exit criteria and focused validation
  pass or an exact accepted gap is recorded here.
