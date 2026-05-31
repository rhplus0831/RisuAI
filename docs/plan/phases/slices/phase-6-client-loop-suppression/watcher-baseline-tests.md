# Watcher Baseline Tests

Status: planned.

## Source Anchors

- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/chatBridge.svelte.ts`
- `src/ts/server/lorebookBridge.svelte.ts`
- `src/ts/server/scriptDefinitionBridge.svelte.ts`
- `src/ts/storage/database.svelte.ts`

## Scope

Add regression tests for watcher behavior during server-origin projection
refreshes, local edits, rollback, and conflict handling.

## Protocol Behavior

- Server-origin projection updates should refresh baselines without dispatching
  redundant commands.
- Local edits after refresh should still dispatch exactly one intended command.
- Rollback should restore the correct pre-command snapshot.

## Done When

- At least one test catches echo-on-projection behavior.
- Tests cover local edit after server refresh.
- Bridge-specific edge cases are documented in test names.

## Validation

- Focused bridge tests under `src/ts/server`.
