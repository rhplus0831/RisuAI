# Phase 9 Client Thinning - 9-2e Translator Presets

Date: 2026-05-25

9-2e is closed. It moves translator preset create/import, rename/update,
delete, and selection behind typed Fastify commands in server-backed web
mode while preserving legacy translator runtime-field sync.

## Landed

- Added stable `id` normalization for translator presets in the current
  schema path.
- Added `server/fastify/src/commands/translatorPresets.ts` for translator
  preset id normalization, payload validation, selected-preset lookup,
  delete fallback selection, and legacy `translatorPrompt` /
  `translatorMaxResponse` sync.
- Added Fastify translator preset command routes:
  `POST /api/v1/commands/translator-presets`,
  `PATCH /api/v1/commands/translator-presets/:presetId`,
  `DELETE /api/v1/commands/translator-presets/:presetId`, and
  `POST /api/v1/commands/translator-presets/select`.
- Added translator preset command events:
  `translatorPreset.created`, `translatorPreset.updated`,
  `translatorPreset.deleted`, and `translatorPreset.selected`.
- Added typed browser helpers in `src/ts/server/commands.ts` for
  translator preset create/update/delete/select commands.
- Routed server-backed translator preset create/import, rename, delete,
  selection, prompt edits, and max-response edits through typed commands
  while keeping legacy local mode mutation behavior intact.

## Notes For Later Slices

- `translatorPresetId` remains the projected selected index for existing
  UI reads, while command payloads address translator presets by stable
  `presetId`.
- Create/import commands support selecting the new preset in the same
  transaction because the current UI immediately selects newly added
  translator presets and syncs legacy runtime fields.
- Runtime translation request dispatch remains browser-side and was not
  changed by this slice.
- 9-5 should still include translator preset surfaces in the residual
  direct-write sweep before enabling the read-only `DBState.db` guard.
- Plugin database bridge translation for `translatorPresets`,
  `translatorPresetId`, and translator runtime fields remains owned by
  9-4f.

## Covered

- Fastify translator preset create/update/delete/select success paths.
- Legacy-field sync for selected translator preset updates and selection.
- Validation/no-revision-bump behavior for malformed updates and duplicate
  create ids.
- 404 missing translator preset behavior and 409 stale-revision conflict
  behavior.
- Browser helper request shapes, conflict retry, and Fastify platform
  gating through the shared command runner.
- Translator preset id normalization for missing and duplicate ids.

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
- `pnpm test` - 674 tests passed, 4 skipped.
- `pnpm api:test` - 1078 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-2f - Loadouts**:

- Implement loadout save/delete/favorite/touch commands from
  `docs/fastify/phases-completed/phase-9-command-map.md`.
- Replace server-backed web loadout list and bookkeeping mutation paths
  with typed commands.
- Keep loadout apply composite/deferred until every touched resource has a
  command.
- Keep character/chat/message resources, projection enforcement,
  provider-key masking, plugin bridge work, and server `.risu` codec work
  in their later slices.
