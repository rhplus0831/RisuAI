# Command Mutation-Range Narrowing Status

Date: 2026-06-03

This is the status router for the command mutation-range narrowing workstream.
Use it first, then open only the phase or slice needed for the next task.

Current status reflects the seed audit
[`mutation-range-mismatch.md`](mutation-range-mismatch.md), audited 2026-06-03.
Phase 0 (baseline foundations), Phase 1 (the message-free floor), Phase 2
(settings + plugin-storage paths), and Phase 3 (single character/chat-row paths)
have landed. The narrow runtime paths now include the reference fix `b57df5cd`
(`characters/select`), the six targeted message commands, the six
`targeted-settings` routes, the three `targeted-plugin-storage` routes, and the
twelve Tier-3 `targeted-character-row` / `targeted-chat-row` routes; the
remaining floor routes (Tier-4 collections, Tier-5 blocked) still rewrite the
broad table set.

## Current Snapshot

Analysis is complete. Phases 0-3 have landed; the Tier-4 collection-table tier
(Phase 4) has not started.

- Phase 3 landed (`07971179`→`65e57c0a`, four stages): all 12 Tier-3 routes write
  only their target character/chat row(s) + documented co-writes. Pure
  character-row edits and the chat-folder/reorder cascades report
  `targeted-character-row`; scriptstate (the hot path), chats/:id, and
  chats/:id/lorebooks report `targeted-chat-row`; fork does surgical
  character/chat/message writes. New writer-kit entries: `writeCharacterChatRows`,
  `insertCharacterChatRow`. Proven by `commandSingleRowPaths.test.ts` (15 tests).

- Phase 2 landed (`56ddd865`): the six Tier-1 settings-scalar routes
  (settings/:group, prompt-settings, characters/reorder, plugins/provider,
  modules/enable, lorebooks/:id/select) now issue one `UPDATE settings`
  (`targeted-settings`; the memory group additionally co-writes `hypa_v3_presets`
  when the patch carries `hypaV3Presets`), and the three Tier-2 plugin-storage
  routes (put/delete/bulk) write only `plugin_custom_storage`
  (`targeted-plugin-storage`). Proven by `commandSettingsAndPluginStorageRange.test.ts`
  (targeted path + exact `writtenTables` + character/chat rowid stability).

- Phase 1 landed (`208e538a`): the 62 safe `hydrated` non-message routes now run
  on `applyMessageFreeJsonCommandMutation`, dropping the all-message load and the
  no-op `syncChatMessages` chat-row rewrite. The four message-dependent routes
  (2390, 2495, 2617, 2655) are unchanged and handed to Phase 3/Phase 6. This is a
  stopgap: a `message-free` route still rewrites all characters, the nine
  collection tables, and settings.

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

Phases 0, 1, 2, and 3 are implemented; the collection-table and later tier
phases below (Phase 4 onward) are still planned.

## Phase Router

| Phase | Status | Open when working on... |
| --- | --- | --- |
| [Phase 0](phases/phase-0-baseline-foundations.md) | Implemented | Writer kit, targeted mutation paths, mutation-range metric, review gates, normalization-scope policy. |
| [Phase 1](phases/phase-1-message-free-floor.md) | Implemented | The mechanical `hydrated` to `message-free` sweep across the 62 non-message routes. |
| [Phase 2](phases/phase-2-settings-and-plugin-storage-paths.md) | Implemented | Tier-1 settings/pointer-only writes and Tier-2 plugin custom storage writes. |
| [Phase 3](phases/phase-3-single-row-paths.md) | Implemented | Tier-3 single character-row and single chat-row metadata edits. |
| [Phase 4](phases/phase-4-collection-table-paths.md) | Planned | Tier-4 single collection-table edits across the eight collection families. |
| [Phase 5](phases/phase-5-projection-range-narrowing.md) | Planned | Narrow projection resources, the `lorebook` resource split, and the projection-field bug fixes. |
| [Phase 6](phases/phase-6-message-free-ceiling.md) | Planned | Tier-5 routes blocked at the `message-free` floor and their unblock conditions. |
| [Phase 7](phases/phase-7-verification-budgets.md) | Planned | Written-table-set, rowid-stability, and `dbJsonWriteMs: 0` gates and the verification log. |

## Active Risk Summary

[`active-risk-analysis.md`](active-risk-analysis.md) has the per-tier detail.
Headlines, in priority order:

- Tier 1 (highest ratio): DONE (Phase 2). The six settings-scalar routes now
  issue one `UPDATE settings` instead of rewriting every character row + every
  chat row + nine collection tables.
- Tier 2: DONE (Phase 2). The three plugin-storage routes now write only
  `plugin_custom_storage` (upsert/delete/clear) instead of all characters + nine
  collection tables.
- Tier 3: DONE (Phase 3). All 12 single character/chat-row routes write only
  their target row(s); the hot scriptstate write (`2983`) no longer hydrates
  messages or rewrites every character.
- Tier 4 (next): one element of one of nine collection tables rewrites all nine
  plus all characters. Plugins family is the lowest-risk fix (projection already
  narrow).
- Tier 5: deeper narrowing blocked by cross-table spans or load-bearing
  message/normalization dependencies; the `message-free` floor is the ceiling.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). The Phase 1 floor sweep
(`208e538a`) is the latest runtime change; it is behavior-preserving, so the
`writtenTables` broad-set baseline still stands and the per-row gates remain
unpopulated until Phase 2.

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
