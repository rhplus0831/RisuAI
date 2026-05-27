# Phase 9 Client Thinning - 9-2f Loadouts

Date: 2026-05-25

9-2f is closed. It moves loadout save/delete/favorite/last-used
bookkeeping behind typed Fastify commands in server-backed web mode while
leaving legacy local mode mutation behavior intact.

## Landed

- Added `server/fastify/src/commands/loadouts.ts` for loadout id
  normalization, payload validation, collection normalization, and stable
  id lookup.
- Added Fastify loadout command routes:
  `POST /api/v1/commands/loadouts`,
  `PATCH /api/v1/commands/loadouts/:loadoutId`,
  `DELETE /api/v1/commands/loadouts/:loadoutId`,
  `POST /api/v1/commands/loadouts/:loadoutId/favorite`, and
  `POST /api/v1/commands/loadouts/:loadoutId/touch`.
- Added loadout command events: `loadout.created`, `loadout.updated`,
  `loadout.deleted`, `loadout.favorited`, and `loadout.touched`.
- Added typed browser helpers in `src/ts/server/commands.ts` for loadout
  create/update/delete/favorite/touch commands.
- Routed server-backed loadout save, favorite toggle, delete, and touch
  bookkeeping through typed commands with optimistic local rollback.
- Kept loadout apply composite/deferred. The current browser apply path
  can still touch modules, global variables, persona selection, and preset
  selection; later slices own those resource families before projection
  enforcement.

## Notes For Later Slices

- Loadout touch commands update `lastUsed`, append the optional current
  `characterId`, and set `lastLoadedLoadoutName`.
- No loadout apply endpoint or `loadout.applied` event landed in 9-2f
  because apply crosses resources owned by 9-2b, 9-2d, 9-4c, and later
  projection/storage slices.
- Import normalization only touches loadout shape when incoming data
  already contains `loadouts` or `lastLoadedLoadoutName`; unrelated
  imported databases keep their exact shape.
- 9-5 should still include loadout surfaces in the residual direct-write
  sweep before enabling the read-only `DBState.db` guard.
- Plugin database bridge translation for `loadouts` and
  `lastLoadedLoadoutName` remains owned by 9-4f.

## Covered

- Fastify loadout create/update/delete/favorite/touch success paths.
- Validation/no-revision-bump behavior for malformed updates and
  duplicate create ids.
- 404 missing loadout behavior and 409 stale-revision conflict behavior.
- Browser helper request shapes, conflict retry, and Fastify platform
  gating through the shared command runner.
- Bootstrap visibility after successful loadout commands.

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
- `pnpm test` - 676 tests passed, 4 skipped.
- `pnpm api:test` - 1081 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-3 - Characters, chats, messages**:

- Start with 9-3a character catalog and scalar profile commands unless
  the next agent finds a sharper dependency.
- Keep lorebooks, modules, plugins, projection enforcement,
  provider-key masking, plugin bridge work, and server `.risu` codec work
  in their later slices.
