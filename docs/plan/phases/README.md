# Command Mutation-Range Narrowing Phases

Date: 2026-06-03

Use these files for phase-specific status, scope, exit criteria, and slice
routing. Concrete slice definitions live under
`slices/[phase]/[slice-name].md`.

| Phase | Status | Phase doc | Slice folder |
| --- | --- | --- | --- |
| 0 | Implemented | [`phase-0-baseline-foundations.md`](phase-0-baseline-foundations.md) | [`slices/phase-0-baseline-foundations/`](slices/phase-0-baseline-foundations/) |
| 1 | Implemented | [`phase-1-message-free-floor.md`](phase-1-message-free-floor.md) | [`slices/phase-1-message-free-floor/`](slices/phase-1-message-free-floor/) |
| 2 | Implemented | [`phase-2-settings-and-plugin-storage-paths.md`](phase-2-settings-and-plugin-storage-paths.md) | [`slices/phase-2-settings-and-plugin-storage-paths/`](slices/phase-2-settings-and-plugin-storage-paths/) |
| 3 | Implemented | [`phase-3-single-row-paths.md`](phase-3-single-row-paths.md) | [`slices/phase-3-single-row-paths/`](slices/phase-3-single-row-paths/) |
| 4 | Implemented | [`phase-4-collection-table-paths.md`](phase-4-collection-table-paths.md) | [`slices/phase-4-collection-table-paths/`](slices/phase-4-collection-table-paths/) |
| 5 | Implemented | [`phase-5-projection-range-narrowing.md`](phase-5-projection-range-narrowing.md) | [`slices/phase-5-projection-range-narrowing/`](slices/phase-5-projection-range-narrowing/) |
| 6 | Implemented | [`phase-6-message-free-ceiling.md`](phase-6-message-free-ceiling.md) | [`slices/phase-6-message-free-ceiling/`](slices/phase-6-message-free-ceiling/) |
| 7 | Implemented (log upkeep ongoing) | [`phase-7-verification-budgets.md`](phase-7-verification-budgets.md) | [`slices/phase-7-verification-budgets/`](slices/phase-7-verification-budgets/) |
| 8 | In progress | [`phase-8-floor-unblocks.md`](phase-8-floor-unblocks.md) | [`slices/phase-8-floor-unblocks/`](slices/phase-8-floor-unblocks/) |

## Slice Rules

- One slice should name one implementation batch or proof batch.
- Each slice should include scope, source anchors (with route line numbers),
  the target SQLite tables, the settings co-write condition, the
  normalization-drop decision, protocol/revision/event behavior, done criteria,
  and validation commands.
- A phase can have many slices, but a slice should be small enough for an agent
  to pick up directly from [`../next-steps.md`](../next-steps.md).
- Every Tier write slice lands with a rowid-stability regression test and a
  metric review gate; the floor sweep (Phase 1) is the only exception, since it
  changes the helper but not the per-row target.
