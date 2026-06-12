# Phase 5: Projection-Range Narrowing

Status: implemented (`314af90f` field-bug, `f94e51ab` collection resources,
`c3fff925` lorebook split, `608de26c` character/chat branches). All four slices
landed: the `prompt` field-bug fallback, the narrow module + script/trigger
resources, the `globalLorebook`/`characterLorebook` lorebook split, and the
`generation-chat` + `characterRow` per-row branches. Character script/trigger
routes still remain Phase 6 floor writes even though their logical refresh
resource ships `['characters']`. api:test 1611/1, test 951/4, both typechecks +
the client-thinning audit green.

Goal: narrow the read/refresh side. `RESOURCE_PROJECTION_FIELDS` maps each event
resource to the fields a foreign or recovery refresh ships. These refreshes are
rare, but a narrowed write with a broad projection still refreshes too much. The
three field bugs shipped the wrong fields before Phase 5 and were fixed
regardless.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) -
  "Projection-range mismatches (read/refresh side)".
- `server/fastify/src/routes/projection.ts` - `RESOURCE_PROJECTION_FIELDS`
  (line ~34), `characterSelection` (~36), `loadCharacterSelectionProjection`
  (~7, ~282).
- `src/ts/server/projection.ts`, `src/ts/bootstrap.ts` - client projection apply
  and full-bootstrap fallback.

## Slices

- [`character-chat-projection-branches.md`](slices/phase-5-projection-range-narrowing/character-chat-projection-branches.md) -
  narrow per-character / per-chat / per-folder / `generation.persisted` branches
  (templates: `characterSelection` / `characterLorebook`). `generation.persisted`
  is the branch that actually fires foreign, so it is the most worth a narrow
  per-chat branch. Co-scheduled with Phase 3.
- [`collection-projection-resources.md`](slices/phase-5-projection-range-narrowing/collection-projection-resources.md) -
  narrower `module` resources (`moduleEnabled` / `reordered` / `updated` instead
  of the shared `['modules','enabledModules','loadouts','characters']`) plus
  module-scoped script/trigger resources. Character script/trigger writes remain
  a Phase 6 floor-route exception.
- [`lorebook-resource-split.md`](slices/phase-5-projection-range-narrowing/lorebook-resource-split.md) -
  split the broad `lorebook` resource
  (`['characters','modules','loreBook','loreBookPage']`) into a `globalLorebook`
  resource shipping only `['loreBook','loreBookPage']`, separate from the
  character/chat/module `globalLore`/`localLore`/`lorebook` events.
- [`projection-field-bug-fixes.md`](slices/phase-5-projection-range-narrowing/projection-field-bug-fixes.md) -
  `prompt`/`promptItem` ship `['botPresets']` (wrong); `persona` omits the legacy
  mirror scalars; `loadout` omits `lastLoadedLoadoutName`.

## Exit Criteria

- Each narrowed write from Phases 2-4 has a matching projection branch (or an
  explicit note that its resource is sprawling-by-design and correct).
- `prompt` falls back to full/sprawling; `promptItem` ships `['promptTemplate']`;
  `persona` includes the mirror scalars; `loadout` includes
  `lastLoadedLoadoutName`.
- The `lorebook` resource is split so a global-lorebook command refresh no longer
  re-ships every character and module.
- Projection tests assert a foreign refresh reflects exactly the changed fields.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/server/projection.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
