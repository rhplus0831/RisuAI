# Phase 9 Client Thinning - 9-3a Characters

Date: 2026-05-25

9-3a is closed. It moves character catalog lifecycle, selection,
ordering/folder metadata, trash/restore bookkeeping, and scalar profile
edits behind typed Fastify commands in server-backed web mode while
leaving legacy local mode mutation behavior intact.

## Landed

- Added `server/fastify/src/commands/characters.ts` for character
  `chaId` normalization, scalar patch validation, catalog order
  validation, stable lookup, and current-character normalization.
- Added Fastify character command routes:
  `POST /api/v1/commands/characters`,
  `PATCH /api/v1/commands/characters/:characterId`,
  `DELETE /api/v1/commands/characters/:characterId`,
  `POST /api/v1/commands/characters/select`, and
  `POST /api/v1/commands/characters/reorder`.
- Added character command events: `character.created`,
  `character.updated`, `character.deleted`, `character.selected`, and
  `character.reordered`.
- Added typed browser helpers in `src/ts/server/commands.ts` for
  character create/update/delete/select/reorder commands.
- Added `src/ts/characterCommands.ts` and
  `src/ts/server/characterBridge.svelte.ts` for optimistic browser
  dispatch, rollback, and debounced scalar profile patching in Fastify
  mode.
- Routed server-backed create/import/select/delete/trash/restore,
  playground character setup, catalog reorder, and character-folder
  metadata changes through typed commands.

## Notes For Later Slices

- Character scalar patches intentionally reject fields owned by later
  slices: chats, chat folders, lorebooks, scripts/triggers, scriptstate,
  module links, cold-storage pointers, and asset-reference fields such as
  `image`, `emotionImages`, `additionalAssets`, and `ccAssets`.
- Character folder metadata currently rides on the full
  `characterOrder` reorder command because that is the existing schema
  shape. Later projection work should continue treating the command event
  as an invalidation event, not a surgical folder patch contract.
- Server import normalization was not widened for arbitrary imported
  databases in this slice; character normalization happens inside command
  execution. This avoids changing unrelated bootstrap/import behavior
  before the server `.risu` codec work.
- 9-3f still owns compatibility setters and hidden mutation bypasses such
  as plugin/MCP character writes and generic `setCurrentCharacter`
  adapters.
- 9-5 should still include character surfaces in the residual direct-write
  sweep before enabling the read-only `DBState.db` guard.

## Covered

- Fastify character create/update/delete/select/reorder success paths.
- Catalog folder order preservation through create, reorder, and delete.
- Validation/no-revision-bump behavior for malformed scalar patches and
  duplicate/invalid order payloads.
- 404 missing character behavior and 409 stale-revision conflict
  behavior.
- Browser helper request shapes, conflict retry, and Fastify platform
  gating through the shared command runner.
- Bootstrap visibility after successful character commands.

## Verification

Passed before closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 678 tests passed, 4 skipped.
- `pnpm api:test` - 1084 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-3b - Chat records, folders, and metadata**:

- Add chat and chat-folder command coverage for create/update/delete,
  fork, reorder, current chat/page, folder metadata, notes, persona
  binding, and bookmarks.
- Keep message history, generation persistence, chat scriptstate,
  compatibility setters, lorebook/script/trigger child collections,
  projection enforcement, plugin bridge work, and server `.risu` codec
  work in their later slices.
