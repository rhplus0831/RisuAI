# Slice: Module Command Snapshot Narrowing

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: M10. Runtime
change.

## Scope

Split module command rollback state so global module operations capture only
global module state, and character-module operations capture only the targeted
character module field. Today the shared snapshot helper clones the entire
characters array even when the rollback cannot need it.

This slice does not change module command semantics, module patch sanitizing,
chat-level module toggles, lorebook/script-definition bridge narrowing, or MCP
module API behavior beyond using the narrower rollback shape.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M10.
- `src/ts/moduleCommands.ts`: `currentModuleStateSnapshot`,
  `restoreModuleState`, global module command helpers,
  `toggleSelectedCharacterModule`, `dispatchReorderCharacterModules`.
- `src/ts/plugins/plugins.svelte.ts`: `applyPluginDatabasePatch`,
  `dispatchModuleCollectionPatch`, `dispatchEnabledModulesPatch`.
- `src/ts/process/mcp/risuaccess/modules.ts`: module mutation paths.
- Existing focused tests:
  `src/ts/moduleCommands.test.ts`,
  `src/ts/plugins/plugins.test.ts`,
  `src/ts/process/modules.test.ts`,
  `src/ts/process/mcp/risuaccess/tests/modules.test.ts`.

## Target Shape

- Introduce a global-module snapshot that contains only `modules` and
  `enabledModules`.
- Restore only `modules` and `enabledModules` for global create, update,
  delete, enable, reorder, and plugin database patches.
- Introduce a character-module snapshot keyed by stable `characterId`, with
  only the target character's `modules` array or the minimum field payload.
- Use the character-module snapshot for
  `toggleSelectedCharacterModule` and `dispatchReorderCharacterModules`.
- Preserve `toggleSelectedChatModule` as chat-scoped; do not widen it back to
  module or character snapshots.
- Add clone-cost assertions proving global module operations do not clone the
  characters graph, and character-module operations clone only the target row
  or field.
- Add forced-failure rollback tests proving global rollbacks preserve
  concurrent character edits and character-module rollbacks preserve sibling
  character edits.
- Register M10 as `DONE` in the v2 gate with focused clone-cost and rollback
  tests, and flip the M10 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Global module server commands remain no-optimistic-write on the live server
  path when `canUseServerCommands()` is true.
- Non-server fallback behavior still updates local module arrays and refreshes
  the GUI exactly as before.
- Module reorder commands keep the same module ID order and validation
  behavior.
- Rollback by stable ID must survive character index shifts.

## Done Criteria

- Global module command snapshots never clone `DBState.db.characters`.
- Character-module rollback snapshots are bounded to one character row or one
  `modules` field.
- Forced failures restore only the mutated module state and leave unrelated
  edits intact.
- The v2 gate and active-risk row mark M10 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/moduleCommands.test.ts src/ts/plugins/plugins.test.ts \
  src/ts/process/modules.test.ts src/ts/process/mcp/risuaccess/tests/modules.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
