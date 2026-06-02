# Collection Projection Resources

Status: planned. Co-scheduled with Phases 2 and 4.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  the `module` and `scriptDefinition`/`triggerDefinition` broad resources.
- `server/fastify/src/routes/projection.ts` - `module` →
  `['modules','enabledModules','loadouts','characters']`;
  `scriptDefinition`/`triggerDefinition` → `['characters','modules']`.

## Scope

Narrow the collection-family projection resources that re-ship more than the
narrowed write changed.

- `module → ['modules','enabledModules','loadouts','characters']` is shared across
  module create/update/delete/enable/reorder and is correct only for `delete`.
  Add narrower resources: `moduleEnabled` (for the Phase 2 modules/enable write —
  `enabledModules` only), and `moduleReordered`/`moduleUpdated` shipping just the
  `modules` array.
- `scriptDefinition` / `triggerDefinition → ['characters','modules']` re-ship
  whole characters + modules for a one-row script/trigger edit. Narrow to the
  affected character or module row where the Phase 3/Phase 4 write is per-row;
  where the script-definition normalization keeps the write at the whole-`modules`
  table, the resource stays at `['modules']` (or `['characters','modules']` only
  if the write actually touches characters).

## Implementation Scope

- Source files: `server/fastify/src/routes/projection.ts` (resource entries +
  bespoke branches), client apply in `src/ts/server/projection.ts` if needed.
- Emit the new resource from the matching command event so the narrow resource is
  actually used (the command route sets the event `resource`).
- Non-scope: the write narrowing (Phases 2/4); the `lorebook` split (separate
  slice).

## Protocol Behavior

- A resource must ship every field its write changed; `module` `delete` keeps the
  broad resource because `removeModuleReferences` spans characters/chats.
- Narrowing a resource without narrowing its write leaves the refresh shipping
  fields the write no longer changes — do not land a resource ahead of its write.

## Done When

- `modules/enable` emits `moduleEnabled` (ships `enabledModules`); reorder/update
  emit a `modules`-only resource.
- script/trigger edits emit a resource matching their actual write range.
- A projection test asserts each event's foreign refresh reflects exactly the
  changed fields.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/server/projection.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
