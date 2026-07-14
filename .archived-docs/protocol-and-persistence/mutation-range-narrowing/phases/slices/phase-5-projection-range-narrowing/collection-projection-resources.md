# Collection Projection Resources

Status: implemented (`f94e51ab`). `modules/enable` emits `moduleEnabled`
(`['enabledModules']`); module update/reorder emit `moduleUpdated`/
`moduleReordered` (`['modules']`); `module` create/delete keep the broad
resource. Module scripts/triggers emit `moduleScriptDefinition`/
`moduleTriggerDefinition` (`['modules']`). Character scripts/triggers still use a
Phase 6 `message-free` floor write, but their logical refresh resource ships
`['characters']`; do not treat that as proof the write has narrowed below the
floor. All are `mode: 'fields'`, so the generic client merge handles them with no
client change. Proven by `projection.test.ts` ("narrows module enable/update/
reorder…", "narrows script/trigger refreshes…").

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
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
- `scriptDefinition` / `triggerDefinition → ['characters','modules']` originally
  re-shipped whole characters + modules. Module script/trigger writes now rewrite
  only `modules`, so they use module-scoped resources. Character script/trigger
  writes remain Phase 6 floor routes; their resource ships `['characters']` for
  the logical target while the blocker remains documented in Phase 6.

## Implementation Scope

- Source files: `server/fastify/src/routes/projection.ts` (resource entries +
  bespoke branches), client apply in `src/ts/server/projection.ts` if needed.
- Emit the new resource from the matching command event so the narrow resource is
  actually used (the command route sets the event `resource`).
- Non-scope: the write narrowing (Phases 2/4); the `lorebook` split (separate
  slice).

## Protocol Behavior

- A resource must ship every field the supported narrow write changed; `module`
  `delete` keeps the broad resource because `removeModuleReferences` spans
  characters/chats. Character script/trigger writes are the exception tracked in
  Phase 6: their logical resource is narrowed, but their physical write remains
  at the floor.
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
