# Slice: Unload Flush

Phase: [5](../../phase-5-client-write-path-correctness.md). Finding: M8.
Client write-durability change. Coordinates with rollback-suppression and
first-baselines.

## Scope

Flush every pending debounced server-backed bridge write when the page is about
to disappear, and when a bridge watcher is torn down. A type-then-close inside
the debounce window should persist the final optimistic edit exactly once.

This slice owns pending-patch flushing for the six bridge modules:
settings, character, chat, lorebook, prompt-template, and script-definition.
It does not change command payload semantics, rollback contents, or bridge
diffing rules except where needed to expose an explicit flush hook.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M8.
- `src/ts/server/settingsBridge.svelte.ts`: pending settings patch debounce,
  `watchServerBackedSettings`, and direct `applyServerBackedSettingsPatch`.
- `src/ts/server/characterBridge.svelte.ts`: pending character profile patch
  debounce and `watchServerBackedCharacterProfile` teardown.
- `src/ts/server/chatBridge.svelte.ts`: pending chat metadata and folder
  metadata patch debounces plus `watchServerBackedChatMetadata` teardown.
- `src/ts/server/lorebookBridge.svelte.ts`: pending lorebook replacement
  debounce, `flushPendingLorebookEntryDraftEdit`, and
  `watchServerBackedLorebooks` teardown.
- `src/lib/Setting/Pages/PromptSettings.svelte`: `pendingPromptItemUpdates`
  and `queuePromptItemUpdate` prompt-template debounce state.
- `src/ts/server/promptTemplateBridge.svelte.ts`: prompt-template projection
  write and rollback helpers.
- `src/ts/server/scriptDefinitionBridge.svelte.ts`: pending script-definition
  debounce and `watchServerBackedScriptDefinitions` teardown.
- `src/ts/server/commands.ts`: command dispatch fetch options and the
  `keepalive` transport surface.
- Focused tests:
  `src/ts/server/settingsBridge.svelte.test.ts`,
  `src/ts/server/characterBridge.svelte.test.ts`,
  `src/ts/server/chatBridge.svelte.test.ts`,
  `src/ts/server/lorebookBridge.svelte.test.ts`,
  `src/ts/server/promptTemplateBridge.svelte.test.ts`, and
  `src/ts/server/scriptDefinitionBridge.svelte.test.ts`.

## Target Shape

- Add a public `flushAllPendingBridgePatches()` aggregator in the server bridge
  area, or an equivalent small module that imports the per-bridge flush hooks.
- Each bridge exposes an idempotent flush function that:
  clears its debounce timer,
  captures the currently merged pending command,
  marks that command as dispatched,
  and invokes the normal command path with a `keepalive` option when requested.
- Where pending state is component-owned today, as with prompt-template item
  updates, move it behind a bridge-level flush hook or register that flush hook
  with the aggregator on mount and unregister it on teardown.
- Wire one browser lifecycle listener for `pagehide` and
  `visibilitychange` when `document.visibilityState === 'hidden'`.
- Register the lifecycle listener where server-backed projection bootstrap
  starts, and remove it from the matching teardown path.
- Call the same aggregator from watcher teardown so unmounting a settings panel
  or sidebar cannot drop a pending edit.
- Thread `fetch(..., { keepalive: true })` only for unload/lifecycle flushes.
  Normal debounced dispatches keep the existing transport options.
- Ensure a flush and the original timer cannot both send the same pending
  command, even if the timer fires immediately after the lifecycle event.
- Preserve bridge suppression flags. A flushed command's optimistic rollback
  must not be re-observed as a user edit.
- Register M8 as `DONE` in `src/ts/__tests__/fixCompletenessGateV3.test.ts`
  and flip only the M8 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Every pending bridge patch is flushed at most once per pending state.
- The flushed payload is the already-coalesced final patch, not a stale
  intermediate edit.
- Lifecycle flushes use `keepalive`; ordinary bridge sends do not.
- Watcher teardown and page lifecycle events share the same flush semantics.
- Rollback suppression still prevents self-induced rollback dispatches.
- Bridges without pending work do nothing and do not create command traffic.

## Done Criteria

- A pending settings, character, chat, lorebook, prompt-template, and
  script-definition edit flushes on `pagehide` before its debounce delay.
- `visibilitychange` to `hidden` exercises the same aggregator.
- Watcher teardown flushes pending work without waiting for the timer.
- A pending edit flushed by unload dispatches once, with `keepalive: true`.
- The original debounce timer cannot double-dispatch after a flush.
- M8 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/settingsBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/promptTemplateBridge.svelte.test.ts \
  src/ts/server/scriptDefinitionBridge.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
