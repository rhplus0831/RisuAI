# Slice 8a: Script/Trigger PUTs → targeted-character-row

Status: implemented (`ad5f3cde`). Both PUTs report `targeted-character-row` /
`writtenTables: ['characters']` / `dbJsonWriteMs: 0`; proven by
`commandFloorUnblock.test.ts`.

## Scope

Route `PUT characters/:characterId/scripts` (`commands.ts:4543`) and
`PUT characters/:characterId/triggers` (`commands.ts:4577`) off the
`message-free` broad floor onto `applyTargetedCommandMutation` with
`mutationPath: TARGETED_MUTATION_PATHS.characterRow`, writing only the target
character row. These two are the highest-frequency Tier-5 routes (a 250 ms
debounced watcher in `scriptDefinitionBridge.svelte.ts` fires them per edit while
a user configures a character's regex/triggers).

The `modules/:id/scripts` and `modules/:id/triggers` PUTs are out of scope (module
collection family, not a character row); they keep their current path.

## Target SQLite Tables

- `characters` — exactly one row (`writeSingleCharacterRow`), `chats` stripped.
- Nothing else. `writtenTables` must equal `['characters']`.

## Implementation

For each route, replace `applyMessageFreeJsonCommandMutation` with
`applyTargetedCommandMutation<{ characterId: string }>`, two-arg `mutate(database,
innerDb)`:

```ts
mutate(database, innerDb) {
  const target = normalizeScriptDefinitionDatabase(database)
  const character = readCharacterScriptParent(target, characterId)
  character.customscript = scripts            // (triggers route: character.triggerscript = triggers)
  writeSingleCharacterRow(innerDb, characterId, character)
  return {
    event: { ...COMMAND_EVENT_CATALOG.scriptDefinitionsReplaced, id: characterId },
    extra: { characterId },
  }
}
```

`normalizeScriptDefinitionDatabase` still runs (it validates and locates the
target); its sibling repairs mutate the in-memory clone only and are discarded
because the callback persists just the target row. The incoming payload is already
strictly validated by `readScriptDefinitions` / `readTriggerDefinitions` (throws on
a missing/duplicate id), so the target needs no repair.

## Normalization-Drop Decision

Validate-only via discard (Prerequisite 2). The whole-DB script/trigger repair is
not persisted for siblings on this path; siblings are normalized at import
(`importSnapshot.ts:204`) and the target field is overwritten with validated
input. No normalizer code changes. This matches the `characterUpdated` reference
(`commands.ts:2563`), which already discards sibling de-dup.

## Protocol / Revision / Event Behavior

Unchanged: one revision bump, one persisted `scriptDefinitions.replaced` /
`triggerDefinitions.replaced` event with resource `scriptDefinition` /
`triggerDefinition`, same `{ revision, event, characterId }` response. No
projection change.

## Done When

- Both routes report `mutationPath: targeted-character-row`,
  `writtenTables: ['characters']`, `dbJsonWriteMs: 0`.
- A regression test proves unrelated character rows, all chat rows, and all
  collection rows keep their rowids across a scripts PUT and a triggers PUT, and
  the target character's `customscript` / `triggerscript` is updated.
- `assertCommandMetricGate` passes for both (the `targeted-character-row` gate).

## Validation

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandFloorUnblock.test.ts`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `pnpm api:test`
