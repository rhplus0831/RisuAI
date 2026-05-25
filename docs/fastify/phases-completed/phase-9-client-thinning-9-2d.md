# Phase 9 Client Thinning - 9-2d Personas

Date: 2026-05-25

9-2d is closed. It moves persona create/update/delete/reorder/select and
selected-persona mirror-field persistence behind typed Fastify commands in
server-backed web mode.

## Landed

- Added `server/fastify/src/commands/personas.ts` for persona id
  normalization, payload validation, full-id-list reorder validation,
  selected-persona snapshot saving, and legacy profile mirroring.
- Added Fastify persona command routes:
  `POST /api/v1/commands/personas`,
  `PATCH /api/v1/commands/personas/:personaId`,
  `DELETE /api/v1/commands/personas/:personaId`,
  `POST /api/v1/commands/personas/select`, and
  `POST /api/v1/commands/personas/reorder`.
- Added persona command events:
  `persona.created`, `persona.updated`, `persona.deleted`,
  `persona.selected`, and `persona.reordered`.
- Added typed browser helpers in `src/ts/server/commands.ts` for persona
  create/update/delete/select/reorder commands.
- Routed server-backed persona selection, profile/image mirror updates,
  import create, settings-page create/delete/reorder, and selected
  profile-field edits through typed commands while keeping local/Tauri
  mutation behavior intact.

## Notes For Later Slices

- Persona commands preserve the legacy `selectedPersona` index in the
  current database shape while exposing stable persona ids at the command
  boundary.
- `mirrorLegacyProfile: true` updates `username`, `userIcon`,
  `personaPrompt`, and `userNote` from the selected persona. Select/delete
  commands also support `saveCurrent` so the previous selected persona can
  capture already-edited legacy fields before switching.
- Persona image byte handling still uses the existing local/image helper
  path. Durable persona references now go through persona commands, but
  asset-byte gating remains owned by 9-4d/9-6.
- Chat persona binding writes remain character/chat scope and are still
  deferred to 9-3/9-4 according to the command map.
- 9-5 should still include persona surfaces in the residual direct-write
  sweep before enabling the read-only `DBState.db` guard.
- Plugin database bridge translation for `personas`, `selectedPersona`,
  `username`, `userIcon`, `personaPrompt`, and `userNote` remains owned by
  9-4f.

## Covered

- Fastify persona create/update/delete/reorder/select success paths.
- Selected-persona mirror-field behavior for `username`, `userIcon`,
  `personaPrompt`, and `userNote`.
- Save-current behavior when selecting a different persona.
- Validation/no-revision-bump behavior for malformed persona updates and
  duplicate reorder ids.
- 404 missing persona behavior and 409 stale-revision conflict behavior.
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
- `pnpm test` - 671 tests passed, 4 skipped.
- `pnpm api:test` - 1074 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-2e - Translator presets**:

- Implement translator preset create/update/delete/select commands from
  `docs/fastify/status/phase-9-command-map.md`.
- Preserve translator preset selection and any existing legacy-field sync
  behavior.
- Keep loadouts, character/chat/message resources, projection
  enforcement, provider-key masking, plugin bridge work, and server
  `.risu` codec work in their later slices.
