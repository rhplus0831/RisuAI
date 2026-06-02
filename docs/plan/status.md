# Command Mutation-Range Narrowing Status

Date: 2026-06-03

This is the status router for the command mutation-range narrowing workstream.
Use it first, then open only the phase or slice needed for the next task.

Current status reflects the seed audit
[`mutation-range-mismatch.md`](mutation-range-mismatch.md), audited 2026-06-03.
Phase 0 (baseline foundations) has landed; no route has been narrowed yet, so the
only narrow runtime path is still the reference fix `b57df5cd`
(`characters/select`).

## Current Snapshot

Analysis is complete. Phase 0 scaffolding is in place; the first route-narrowing
tier (Phase 1) has not started.

- Phase 0 landed: the targeted writer kit (`repository.ts`), the
  `TARGETED_MUTATION_PATHS` vehicles (`mutations.ts`), the `writtenTables`
  mutation-range metric + importable review-gate / rowid-stability templates
  (`__tests__/helpers/`), and the normalization-scope policy + `assertOnlyRowsWritten`.
  The over-broad before-state is captured (every `message-free`/`hydrated`
  command rewrites the 13-table broad set for one sub-row change).

- The 79 command routes are classified: 8 already minimal, 71 over-broad (66 on
  `hydrated`, 5 on `message-free`). Severity after adversarial verification is 51
  high, 18 medium, 3 low. The full route table lives in the audit appendix.
- The four mutation helpers and the SQLite table split are mapped (see
  [`plan.md`](plan.md)).
- Four prerequisites are recorded: build the writer kit, treat global
  normalization as validate-only, co-write settings when a pointer moves, and use
  `message-free` as the safe floor.
- The projection-range mismatches are catalogued: broad resources that re-ship
  whole arrays (`character`, `chat`/`message`/`generation`, `lorebook`, `module`,
  `scriptDefinition`/`triggerDefinition`) and three pre-existing field bugs
  (`prompt`/`promptItem` ship `botPresets`, `persona` omits legacy mirror
  scalars, `loadout` omits `lastLoadedLoadoutName`).

Phase 0 is implemented; every tier phase below is still planned.

## Phase Router

| Phase | Status | Open when working on... |
| --- | --- | --- |
| [Phase 0](phases/phase-0-baseline-foundations.md) | Implemented | Writer kit, targeted mutation paths, mutation-range metric, review gates, normalization-scope policy. |
| [Phase 1](phases/phase-1-message-free-floor.md) | Planned | The mechanical `hydrated` to `message-free` sweep across ~62 non-message routes. |
| [Phase 2](phases/phase-2-settings-and-plugin-storage-paths.md) | Planned | Tier-1 settings/pointer-only writes and Tier-2 plugin custom storage writes. |
| [Phase 3](phases/phase-3-single-row-paths.md) | Planned | Tier-3 single character-row and single chat-row metadata edits. |
| [Phase 4](phases/phase-4-collection-table-paths.md) | Planned | Tier-4 single collection-table edits across the eight collection families. |
| [Phase 5](phases/phase-5-projection-range-narrowing.md) | Planned | Narrow projection resources, the `lorebook` resource split, and the projection-field bug fixes. |
| [Phase 6](phases/phase-6-message-free-ceiling.md) | Planned | Tier-5 routes blocked at the `message-free` floor and their unblock conditions. |
| [Phase 7](phases/phase-7-verification-budgets.md) | Planned | Written-table-set, rowid-stability, and `dbJsonWriteMs: 0` gates and the verification log. |

## Active Risk Summary

[`active-risk-analysis.md`](active-risk-analysis.md) has the per-tier detail.
Headlines, in priority order:

- Tier 1 (highest ratio): one settings scalar rewrites every character row +
  every chat row + nine collection tables (+ most load every message). Target:
  one `UPDATE settings`.
- Tier 2: key-addressable plugin storage rewrites all characters + nine
  collection tables. Target: one `plugin_custom_storage` upsert/delete. Written
  by plugins at runtime, so the waste recurs.
- Tier 3: one character row or one chat row, often `hydrated` despite
  touching no messages. The scriptstate write (`2983`) is the hot one.
- Tier 4: one element of one of nine collection tables rewrites all nine plus
  all characters. Plugins family is the lowest-risk fix (projection already
  narrow).
- Tier 5: deeper narrowing blocked by cross-table spans or load-bearing
  message/normalization dependencies; the `message-free` floor is the ceiling.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). No runtime change has
landed for this workstream yet, so that file records the pre-implementation
baseline and the gate set the first slice must populate.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task.
- Use [`active-risk-analysis.md`](active-risk-analysis.md) for the per-tier
  actual-vs-desired write ranges.
- Use [`plan.md`](plan.md) for prerequisites, invariants, and phase order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- Do not drop a broad-path write until the code, the audit, and the relevant
  structure doc show no reader depends on it.
- Every narrow slice lands with a rowid-stability regression test and a metric
  review gate; do not mark a tier implemented without both.
- Update this status and the phase router after a phase changes state.
