# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code commit under test: Phase 2 settings + plugin-storage paths
  (`56ddd865` on `fastify`). The six Tier-1 settings-scalar routes route onto
  `applyTargetedCommandMutation` (`targeted-settings`, one `UPDATE settings`; the
  memory group co-writes `hypa_v3_presets` when the patch carries `hypaV3Presets`)
  and the three Tier-2 plugin-storage routes onto `targeted-plugin-storage` (only
  `plugin_custom_storage`).
- Scope: server (`routes/commands.ts` nine routes, `repository.ts` exports
  `extractSettings` + adds `replacePluginStorage`), plus the `targeted-settings`
  gate relax, the `commandMetrics.test.ts` update, and the new
  `commandSettingsAndPluginStorageRange.test.ts` (10 tests). First per-row write
  narrowing in this workstream beyond the `characters/select` reference.
- Result: green. The narrowed routes drop the broad 13-table rewrite: settings
  routes write `['settings']` (or `['hypa_v3_presets','settings']` for the memory
  group), plugin-storage routes write `['plugin_custom_storage']`, with character
  and chat rowids proven stable.

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1541 passed, 1 skipped (88 files); +10 vs the Phase 1 baseline (the new Phase 2 regression). |
| `pnpm test` | 948 passed, 4 skipped (100 files); unchanged — server-only diff. |
| `pnpm client-thinning:audit` | Passed. |
| `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test commandMetrics` | Passed; settings → `targeted-settings`/`['settings']`, pluginStorage → `targeted-plugin-storage`/`['plugin_custom_storage']`, chat still `message-free`/13 tables. |
| `pnpm api:test commandSettingsAndPluginStorageRange` | 10 passed (targeted path + exact `writtenTables` + rowid stability + put/delete/bulk-clear). |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | Passed (zero errors). |

## Notes

- The review gate for the reference fix is `mutationPath:
  'targeted-character-selection'` with `dbJsonWriteMs: 0` and `writtenTables:
  ['characters', 'settings']`. Each new narrow path adds (or reuses) the matching
  gate in `__tests__/helpers/commandMetricGates.ts` and asserts row scope through
  `assertOnlyRowsWritten` (`helpers/rowStability.ts`) before it counts as verified.
- The mutation-range metric baseline (Phase 0) is now live: `command_mutation`
  records `writtenTables`, so the before/after table set is the proof a write
  narrowed, not just timing.
- Next slice (Phase 3 single-row paths): narrow the single character-row and
  single chat-row metadata edits onto `targeted-character-row` / `targeted-chat-row`
  via the writer kit, landing the matching Phase 5 character/chat projection
  branches in the same batches; each lands with its rowid-stability test + metric
  gate, then re-run `pnpm api:test`, the `commandMetrics` summary,
  `pnpm client-thinning:audit`, and the type check, and refresh this file.
