# Watcher Baseline Tests

Status: implemented.

## Source Anchors

- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/chatBridge.svelte.ts`
- `src/ts/server/lorebookBridge.svelte.ts`
- `src/ts/server/scriptDefinitionBridge.svelte.ts`
- `src/ts/storage/database.svelte.ts`

## Scope

Add regression tests for watcher behavior during server-origin projection
refreshes, local edits, rollback, and conflict handling.

Current coverage: `src/ts/server/lorebookBridge.svelte.test.ts` protects the
hydrated-lorebook no-data-loss invariant. Settings, chat, and script-definition
tests now cover server-origin projection refreshes, local edits after refresh,
and rollback suppression.

## Protocol Behavior

- Server-origin projection updates should refresh baselines without dispatching
  redundant commands. Done.
- Local edits after refresh should still dispatch exactly one intended command.
  Done.
- Rollback should restore the correct pre-command snapshot. Done.

## Done When

- At least one test catches echo-on-projection behavior. Done.
- Tests cover local edit after server refresh. Done.
- Bridge-specific edge cases are documented in test names. Done.

## Validation

- `pnpm test -- src/ts/server/settingsBridge.svelte.test.ts src/ts/server/chatBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts`
- `pnpm test -- src/ts/server`
