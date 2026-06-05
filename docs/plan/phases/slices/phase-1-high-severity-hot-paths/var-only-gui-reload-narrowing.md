# Slice: Var-Only GUI Reload Narrowing

Phase: [1](../../phase-1-high-severity-hot-paths.md). Finding: H3. Depends on
the Phase 0 render-count harness and v2 gate. Runtime change.

## Scope

Stop variable-only trigger updates from forcing a whole-screen `ChatBody`
remount and cold script/regex re-parse. The live H3 targets are the trigger
paths that bump `ReloadGUIPointer` after variable writes or an explicit V2 GUI
update, plus the global subscriber that currently resets every per-message
reload entry and wipes module-level script caches.

This slice does not own Phase 5's broader render optimizations such as
content-keyed `ParseMarkdown` memoization, translate-detection memoization, or
prompt-template UI work.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  H3, M17, and L40 notes.
- `src/ts/stores.svelte.ts`: `ReloadGUIPointer.subscribe` clearing
  `ReloadChatPointer` and calling `resetScriptCache()`.
- `src/lib/ChatScreens/Chat.svelte`: the message `{#key}` built from
  `$ReloadGUIPointer + ($ReloadChatPointer[idx] ?? 0)`.
- `src/ts/process/triggers.ts`: the `varChanged` bump, `v2UpdateGUI`, and the
  existing per-message `v2UpdateChatAt` path.
- `src/ts/process/scriptings.ts`: `reloadDisplay` and `reloadChat` API shape.
- `src/ts/process/scripts.ts`: `processScriptCache`, `compiledRegexCache`, and
  `resetScriptCache`.
- Phase 0 render-count harness/test and existing focused tests:
  `src/ts/process/__tests__/streamResponse.test.ts`,
  `src/ts/process/triggers.regexMemo.test.ts`.

## Target Shape

- Split "reload display because variable state changed" from "reload because
  script/module/settings definitions changed." Prefer explicit helper functions
  or explicit reload reasons over relying on the top-level
  `ReloadGUIPointer.subscribe` side effect.
- Remove the whole-screen key dependency for variable-only updates. Acceptable
  shapes include:
  - routing variable-only refreshes through `ReloadChatPointer` entries for
    known affected messages, reusing the `v2UpdateChatAt` mechanism; or
  - dropping the global `{#key}` remount for variable-only changes and letting
    the existing parse/result path re-derive without destroying every
    `ChatBody` instance.
- Stop calling `resetScriptCache()` for variable-only bumps, including
  `runTrigger` `varChanged` and `v2UpdateGUI`. The module-level
  `processScriptCache` and `compiledRegexCache` must survive these updates.
- Keep full refresh semantics for module/settings/script-definition changes.
  Those paths may still reset the script caches and refresh all mounted
  messages when the definitions that feed parsing have actually changed.
- Preserve `v2UpdateChatAt` and `reloadChat` as per-message mechanisms.
  If `reloadDisplay` remains a broad display refresh, document and test whether
  it is cache-preserving or cache-resetting; it must not accidentally become the
  var-only trigger path.
- Flip the Phase 0 render-count baseline assertions for H3: a variable-only
  GUI update should re-parse zero messages or only the explicitly affected
  message entries, never all mounted messages.
- Register H3 as `DONE` in the v2 gate with the render-count/cache-lifetime
  regression tests, and flip the H3 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Do not rely on `ChatBody` instance-local state as the fix. H3 explicitly
  destroys that state today, and Phase 5 L40 owns any broader module-level
  markdown memo work.
- A variable-only update must not clear `processScriptCache` or
  `compiledRegexCache`.
- Module/settings/script-definition reloads must still refresh stale display
  output and clear caches when script definitions changed.
- The v1 H3 stream coalescer behavior must remain intact.
- The existing Phase 7 regex memo tests must remain meaningful: do not hide the
  cache lifetime by deleting the memo or loosening assertions.

## Done Criteria

- The render-count probe shows a var-only GUI bump no longer remounts and
  re-parses every mounted message.
- Cache-lifetime assertions prove `processScriptCache` and
  `compiledRegexCache` survive var-only bumps and are cleared by true
  definition-level reloads.
- Focused stream and regex-memo suites stay green.
- The H3 v2 gate entry points at real tests and the risk-map row is `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts \
  src/ts/process/__tests__/streamResponse.test.ts \
  src/ts/process/triggers.regexMemo.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
```
