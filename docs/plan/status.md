# Command Mutation-Range Narrowing Status

Date: 2026-06-03

This is the status router for the command mutation-range narrowing workstream.
Use it first, then open only the phase or slice needed for the next task.

Current status reflects the seed audit
[`mutation-range-mismatch.md`](mutation-range-mismatch.md), audited 2026-06-03.
Phase 0 (baseline foundations), Phase 1 (the message-free floor), Phase 2
(settings + plugin-storage paths), Phase 3 (single character/chat-row paths),
Phase 4 (collection-table paths, all eight families), and Phase 5
(projection-range narrowing) have landed. The narrow runtime paths now include
the reference fix `b57df5cd` (`characters/select`), the six targeted message
commands, the six `targeted-settings` routes, the three `targeted-plugin-storage`
routes, the twelve Tier-3 `targeted-character-row` / `targeted-chat-row` routes,
and all the Tier-4 `targeted-collection` family routes; the read side now narrows
the projection resources to match. The remaining floor routes (Tier-5 blocked)
still rewrite the broad table set.

## Current Snapshot

Analysis is complete. Phases 0-5 have landed; Phase 6 (the Tier-5
`message-free` ceiling) is the next tier.

- Phase 5 implemented (projection-range narrowing, four slices): the read/refresh
  side now narrows each event's projection resource to its write range. The
  `prompt` field-bug now falls back to full (`314af90f`); the shared `module`
  resource split into `moduleEnabled`/`moduleUpdated`/`moduleReordered` and the
  script/trigger resources into character (`['characters']`) vs module
  (`moduleScriptDefinition`/`moduleTriggerDefinition`, `['modules']`) (`f94e51ab`);
  the broad `lorebook` resource split into `globalLorebook` (global commands) +
  per-row `characterLorebook`/`chat`/`moduleUpdated` (`c3fff925`); and the
  foreign-firing `generation.persisted` got a per-chat `generation-chat` branch
  while characterUpdated/modules-reorder/chatUpdated/chatFolderUpdated got a
  per-character `characterRow` branch (`608de26c`). Proven by `projection.test.ts`
  and `bootstrap.test.ts`.

- Phase 4 implemented (all 8 collection families): every Tier-4 collection route
  now runs on `applyTargetedCommandMutation` with
  `mutationPath: targeted-collection`, writing only its own collection table
  (single-row `UPDATE` for pure field edits; one-table rewrite for
  create/delete/reorder) plus the pointer/mirror settings scalars only when they
  moved. The families: plugins, bot_presets, prompt_templates, personas,
  translator_presets (unconditional settings re-sync), loadouts, lore_books
  (child-lorebook repairs dropped to validate-only), and modules
  (scripts/triggers cross-character repairs dropped to validate-only). Preset
  `apply=true` co-writes `prompt_templates` through the named
  `writePromptTemplatesTable` wrapper. Three projection-field bugs fixed inline:
  `promptItem`→`['promptTemplate']`, `persona` reships the four legacy mirror
  scalars, and `loadout` reships `lastLoadedLoadoutName`; the broad `lorebook` /
  `module` projection resources are deferred to Phase 5. Proven by
  `commandCollectionRange.test.ts` (45 tests) plus the `projection.test.ts`
  field-bug assertions.

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

Phases 0-5 are implemented; the later tier phases below (Phase 6 onward) are
still planned.

## Phase Router

| Phase | Status | Open when working on... |
| --- | --- | --- |
| [Phase 0](phases/phase-0-baseline-foundations.md) | Implemented | Writer kit, targeted mutation paths, mutation-range metric, review gates, normalization-scope policy. |
| [Phase 1](phases/phase-1-message-free-floor.md) | Implemented | The mechanical `hydrated` to `message-free` sweep across the 62 non-message routes. |
| [Phase 2](phases/phase-2-settings-and-plugin-storage-paths.md) | Implemented | Tier-1 settings/pointer-only writes and Tier-2 plugin custom storage writes. |
| [Phase 3](phases/phase-3-single-row-paths.md) | Implemented | Tier-3 single character-row and single chat-row metadata edits. |
| [Phase 4](phases/phase-4-collection-table-paths.md) | Implemented | Tier-4 single collection-table edits across all eight collection families. |
| [Phase 5](phases/phase-5-projection-range-narrowing.md) | Implemented | Narrow projection resources, the `lorebook` resource split, and the projection-field bug fixes. |
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
- Tier 4: DONE (Phase 4). One element of one of nine collection tables used to
  rewrite all nine plus all characters. All eight families now write only their
  own table (+ pointer/mirror settings, and for preset apply the prompt_templates
  co-write); lore_books child-lorebook and modules scripts/triggers
  cross-character repairs are dropped to validate-only.
- Tier 5: deeper narrowing blocked by cross-table spans or load-bearing
  message/normalization dependencies; the `message-free` floor is the ceiling.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). Phase 5 (the
projection-range narrowing, `608de26c`) is the latest runtime change; it narrows
the read/refresh side only (no write range changed). api:test 1611/1, test
951/4, both typechecks + the client-thinning audit green.

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
