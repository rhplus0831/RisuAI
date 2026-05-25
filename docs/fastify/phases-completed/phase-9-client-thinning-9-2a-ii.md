# Phase 9 Client Thinning - 9-2a-ii Manual Scalar Settings Pages

Date: 2026-05-25

9-2a-ii is closed. It extends the grouped scalar settings command route
from data-driven settings wrappers to the named manual scalar settings
surfaces.

## Landed

- Added `patchServerBackedSettings` in `src/ts/server/commands.ts` to
  group arbitrary scalar setting patches, read the current command
  revision, retry once on 409 conflicts, and run an optional rollback on
  command failure.
- Added `src/ts/server/settingsBridge.svelte.ts`, a Fastify-only watcher
  bridge for manual Svelte settings surfaces. It observes configured
  top-level scalar roots, debounces grouped command dispatch, and rolls
  back optimistic local values only when the attempted value is still
  current.
- Routed the named manual surfaces through the bridge:
  `BotSettings.svelte`, `OtherBotSettings.svelte`,
  `OpenrouterSettings.svelte`, `OobaSettings.svelte`,
  `SeparateParametersSection.svelte`,
  `Model/AuxModelSelectors.svelte`,
  `Others/ProTools/EasyPanel.svelte`, and `WelcomeRisu.svelte`.
- Extended the browser and Fastify scalar maps for manual
  provider/runtime/media/account fields such as reverse-proxy URL,
  custom tokenizer, echo model settings, easy-panel enablement,
  media emotion processor, and first-run username/setup flags.
- Kept provider-key masking out of scope. Provider settings commands
  still update current unmasked fields directly until 9-6.

## Notes For Later Slices

- The bridge intentionally preserves Tauri/local mutation paths; it is a
  no-op when Fastify commands are unavailable.
- The migrated manual pages still contain direct Svelte `DBState.db`
  binds for local optimistic UI state. They now dispatch durable writes
  through commands in Fastify mode, but 9-5 should still do the residual
  direct-write audit before enabling the read-only `DBState.db` guard.
- Prompt template/items and prompt-setting behavior remain deferred to
  9-2c. Bot preset lifecycle and preset apply/copy/select behavior remain
  deferred to 9-2b.
- `username` was allowlisted under the account scalar group for first-run
  setup. Persona mirror behavior remains owned by 9-2d.

## Covered

- Browser helper behavior for mixed-group scalar patches.
- Conflict retry for manual-page command dispatch.
- Rollback callback on command failure.
- No command dispatch and no rollback outside Fastify mode.
- Fastify route allowlists for representative manual provider, runtime,
  media, and account scalar roots.

## Verification

Passed:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 663 tests passed, 4 skipped.
- `pnpm api:test` - 1061 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-2b - Bot presets**:

- Implement typed preset lifecycle and selection/apply commands from
  `docs/fastify/status/phase-9-command-map.md`.
- Replace server-backed web preset mutations in
  `src/lib/Setting/botpreset.svelte` and
  `src/ts/storage/database.svelte.ts`.
- Keep prompt template/items, personas, translator presets, and loadouts
  in their later slices.
