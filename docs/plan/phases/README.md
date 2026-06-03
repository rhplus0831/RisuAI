# Frontend Performance Deep-Clone Narrowing Phases

Date: 2026-06-03

Use these files for phase-specific status, scope, exit criteria, and slice
routing. Concrete slice definitions live under
`slices/[phase]/[slice-name].md`.

| Phase | Status | Phase doc | Slice folder |
| --- | --- | --- | --- |
| 0 | Planned | [`phase-0-baseline-foundations.md`](phase-0-baseline-foundations.md) | [`slices/phase-0-baseline-foundations/`](slices/phase-0-baseline-foundations/) |
| 1 | Planned | [`phase-1-projection-write-guard.md`](phase-1-projection-write-guard.md) | [`slices/phase-1-projection-write-guard/`](slices/phase-1-projection-write-guard/) |
| 2 | Planned | [`phase-2-snapshot-family-narrowing.md`](phase-2-snapshot-family-narrowing.md) | [`slices/phase-2-snapshot-family-narrowing/`](slices/phase-2-snapshot-family-narrowing/) |
| 3 | Planned | [`phase-3-cheap-wins.md`](phase-3-cheap-wins.md) | [`slices/phase-3-cheap-wins/`](slices/phase-3-cheap-wins/) |
| 4 | Planned | [`phase-4-script-definition-watcher.md`](phase-4-script-definition-watcher.md) | [`slices/phase-4-script-definition-watcher/`](slices/phase-4-script-definition-watcher/) |
| 5 | Planned | [`phase-5-prompt-template-keystroke.md`](phase-5-prompt-template-keystroke.md) | [`slices/phase-5-prompt-template-keystroke/`](slices/phase-5-prompt-template-keystroke/) |
| 6 | Planned | [`phase-6-lorebook-watcher-scope.md`](phase-6-lorebook-watcher-scope.md) | [`slices/phase-6-lorebook-watcher-scope/`](slices/phase-6-lorebook-watcher-scope/) |
| 7 | Planned | [`phase-7-opportunistic-cleanups.md`](phase-7-opportunistic-cleanups.md) | [`slices/phase-7-opportunistic-cleanups/`](slices/phase-7-opportunistic-cleanups/) |
| 8 | Planned | [`phase-8-verification-budgets.md`](phase-8-verification-budgets.md) | [`slices/phase-8-verification-budgets/`](slices/phase-8-verification-budgets/) |

## Slice Rules

- One slice should name one implementation batch or proof batch.
- Each slice should include scope, source anchors (with file:line), the data
  being cloned, the hot-path trigger, the target scalar/single-row/single-chat
  snapshot, the rollback-correctness property, the byte-identity / projection
  behavior, done criteria, and validation commands.
- A phase can have many slices, but a slice should be small enough for an agent
  to pick up directly from [`../next-steps.md`](../next-steps.md).
- Every narrowing slice lands with a clone-cost regression test (the hot path
  never clones every character / the whole `Database`) and a rollback-correctness
  test; the cheap-win and guard slices land with their own targeted proofs. Do
  not mark a phase implemented without the proof.
