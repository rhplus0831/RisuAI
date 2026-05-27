# Phase 9 Client Thinning - 9-2c Prompt Templates/Items

Date: 2026-05-25

9-2c is closed. It moves prompt template enablement, prompt settings, and
prompt item CRUD/reorder behavior behind typed Fastify commands in
server-backed web mode.

## Landed

- Added optional stable `id` fields to prompt item types and normalized
  missing prompt item ids on Fastify `.risu` JSON import and prompt UI
  mutation paths.
- Added Fastify prompt command routes:
  `PATCH /api/v1/commands/prompt-settings`,
  `POST /api/v1/commands/prompt-items`,
  `PATCH /api/v1/commands/prompt-items/:itemId`,
  `DELETE /api/v1/commands/prompt-items/:itemId`, and
  `POST /api/v1/commands/prompt-items/reorder`.
- Added prompt command events:
  `prompt.settings.updated`, `prompt.item.created`,
  `prompt.item.updated`, `prompt.item.deleted`, and
  `prompt.item.reordered`.
- Added typed browser helpers in `src/ts/server/commands.ts` plus a shared
  `runServerCommand` wrapper for base-revision lookup and one conflict
  retry.
- Routed server-backed prompt item create/update/delete/reorder and prompt
  settings edits in `src/lib/Setting/Pages/PromptSettings.svelte`,
  `src/lib/UI/PromptDataItem.svelte`, and prompt-template enablement in
  `src/lib/Setting/Pages/BotSettings.svelte` through typed commands while
  preserving optimistic local behavior and legacy local mode mutation paths.

## Notes For Later Slices

- Prompt item ids are command addressing ids only. Prompt assembly still
  treats them as inert metadata, and generic local `setDatabase` loading
  does not force ids into prompt assembly test fixtures.
- 9-5 should still include prompt template/settings surfaces in the
  residual direct-write sweep before enabling the read-only `DBState.db`
  guard.
- Plugin database bridge translation for `promptTemplate`,
  `promptSettings`, and related prompt/schema fields remains owned by
  9-4f.
- Provider-key masking, personas, translator presets, loadouts, browser
  projection, and server `.risu` codec work remain deferred to their
  later slices.

## Covered

- Fastify prompt settings patch and prompt item create/update/delete/reorder
  success paths.
- Prompt setting validation/no-revision-bump behavior and malformed
  reorder validation/no-revision-bump behavior.
- 404 missing prompt item behavior and 409 stale-revision conflict
  behavior.
- Browser helper request shapes, conflict retry, and Fastify platform
  gating through the shared command runner.

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
- `pnpm test` - 669 tests passed, 4 skipped.
- `pnpm api:test` - 1070 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-2d - Personas**:

- Implement persona create/update/delete/reorder/select commands from
  `docs/fastify/phases-completed/phase-9-command-map.md`.
- Preserve selected-persona mirror semantics for `username`, `userIcon`,
  `personaPrompt`, and `userNote`.
- Keep translator presets, loadouts, projection enforcement,
  provider-key masking, plugin bridge work, and server `.risu` codec work
  in their later slices.
