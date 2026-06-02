# Phase 5: Projection-Range Narrowing

Status: planned. Co-scheduled with Phases 2-4 (a projection branch lands in the
same batch as the write it serves); the field-bug fixes are independent and can
land anytime.

Goal: narrow the read/refresh side. `RESOURCE_PROJECTION_FIELDS` maps each event
resource to the fields a foreign or recovery refresh ships. These refreshes are
rare, but a narrowed write with a broad projection still refreshes too much. The
three field bugs ship the wrong fields today and should be fixed regardless.

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
  of the shared `['modules','enabledModules','loadouts','characters']`) and the
  `scriptDefinition` / `triggerDefinition` whole-characters+modules re-ship.
  Co-scheduled with Phases 2 and 4.
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
