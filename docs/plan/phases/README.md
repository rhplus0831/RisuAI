# Frontend Performance Deep-Clone Narrowing Phases

Date: 2026-06-03

Use these files for phase status, scope, exit criteria, and slice routing.
Concrete slices live under `slices/[phase]/[slice-name].md`.

- Phase 0, planned:
  [`phase-0-baseline-foundations.md`](phase-0-baseline-foundations.md),
  [`slices/phase-0-baseline-foundations/`](slices/phase-0-baseline-foundations/).
- Phase 1, planned:
  [`phase-1-projection-write-guard.md`](phase-1-projection-write-guard.md),
  [`slices/phase-1-projection-write-guard/`](slices/phase-1-projection-write-guard/).
- Phase 2, planned:
  [`phase-2-snapshot-family-narrowing.md`](phase-2-snapshot-family-narrowing.md),
  [`slices/phase-2-snapshot-family-narrowing/`](slices/phase-2-snapshot-family-narrowing/).
- Phase 3, planned: [`phase-3-cheap-wins.md`](phase-3-cheap-wins.md),
  [`slices/phase-3-cheap-wins/`](slices/phase-3-cheap-wins/).
- Phase 4, planned:
  [`phase-4-script-definition-watcher.md`](phase-4-script-definition-watcher.md),
  [`slices/phase-4-script-definition-watcher/`](slices/phase-4-script-definition-watcher/).
- Phase 5, planned:
  [`phase-5-prompt-template-keystroke.md`](phase-5-prompt-template-keystroke.md),
  [`slices/phase-5-prompt-template-keystroke/`](slices/phase-5-prompt-template-keystroke/).
- Phase 6, planned:
  [`phase-6-lorebook-watcher-scope.md`](phase-6-lorebook-watcher-scope.md),
  [`slices/phase-6-lorebook-watcher-scope/`](slices/phase-6-lorebook-watcher-scope/).
- Phase 7, planned:
  [`phase-7-opportunistic-cleanups.md`](phase-7-opportunistic-cleanups.md),
  [`slices/phase-7-opportunistic-cleanups/`](slices/phase-7-opportunistic-cleanups/).
- Phase 8, planned:
  [`phase-8-verification-budgets.md`](phase-8-verification-budgets.md),
  [`slices/phase-8-verification-budgets/`](slices/phase-8-verification-budgets/).

## Slice Rules

- One slice should name one implementation batch or proof batch.
- Each slice should include scope, source anchors, cloned data, trigger, target
  snapshot, rollback property, behavior invariants, done criteria, and validation.
- A phase can have many slices, but a slice should be small enough for an agent
  to pick up directly from [`../next-steps.md`](../next-steps.md).
- Every narrowing slice lands with a clone-cost regression test and a rollback
  test. Cheap-win and guard slices land with their own targeted proofs.
