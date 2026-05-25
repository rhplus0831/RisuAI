# Phase 9 Client Thinning - 9-2b Bot Presets

Date: 2026-05-25

9-2b is closed. It moves bot preset lifecycle, selection, import/copy,
and reorder behavior behind typed Fastify commands in server-backed web
mode.

## Landed

- Added stable `id` fields for bot presets and normalized missing ids on
  local database load and Fastify `.risu` JSON import.
- Added Fastify preset command routes:
  `POST /api/v1/commands/presets`,
  `PATCH /api/v1/commands/presets/:presetId`,
  `DELETE /api/v1/commands/presets/:presetId`,
  `POST /api/v1/commands/presets/:presetId/copy`,
  `POST /api/v1/commands/presets/select`,
  `POST /api/v1/commands/presets/import`, and
  `POST /api/v1/commands/presets/reorder`.
- Added preset command events:
  `preset.created`, `preset.updated`, `preset.deleted`,
  `preset.copied`, `preset.selected`, `preset.imported`, and
  `preset.reordered`.
- Added typed browser helpers in `src/ts/server/commands.ts` plus
  `runServerPresetCommand` for base-revision lookup and one conflict
  retry.
- Routed `src/lib/Setting/botpreset.svelte`,
  `src/lib/Setting/Pages/BotSettings.svelte`,
  `src/ts/storage/database.svelte.ts`, and prompt-conversion preset
  appends through typed commands in Fastify mode while preserving local
  optimistic behavior and Tauri/local mutation paths.

## Notes For Later Slices

- `botPresetsId` remains the projected selected index for existing UI
  reads, while command payloads address presets by stable `presetId`.
  9-5 should still include preset surfaces in the residual direct-write
  sweep before enabling the read-only `DBState.db` guard.
- Preset apply intentionally copies the preset snapshot fields into the
  current top-level settings in one preset command transaction. Prompt
  template/item editing remains owned by 9-2c.
- Provider-key masking remains deferred to 9-6. Preset snapshots still
  carry the current unmasked fields where existing preset behavior does.
- Plugin database bridge translation for `botPresets` and `botPresetsId`
  remains owned by 9-4f.

## Covered

- Fastify create/update/delete/copy/select/import/reorder command success
  paths.
- Selected-preset apply behavior, including saving the previously
  selected preset snapshot before applying the new preset.
- 400 validation/no-revision-bump behavior for malformed reorder payloads.
- 404 missing-preset behavior and 409 stale-revision conflict behavior.
- Browser helper request shape and conflict retry for preset commands.

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
- `pnpm test` - 667 tests passed, 4 skipped.
- `pnpm api:test` - 1066 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-2c - Prompt templates/items**:

- Implement typed prompt template/settings and prompt-item commands from
  `docs/fastify/status/phase-9-command-map.md`.
- Replace server-backed web prompt template/item mutation paths in the
  prompt settings UI and prompt data item helpers.
- Keep personas, translator presets, loadouts, projection enforcement,
  provider-key masking, and server `.risu` codec work in their later
  slices.
