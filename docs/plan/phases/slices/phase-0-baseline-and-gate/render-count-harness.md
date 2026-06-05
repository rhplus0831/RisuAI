# Slice: Render-Count Harness

Phase: [0](../../phase-0-baseline-and-gate.md). No runtime change.

## Scope

Add a test-only harness that can count full client render-parse work across a
simulated `ReloadGUIPointer` bump. This slice creates the reusable measuring
tool only; the baseline assertion and verification log happen in later slices.

## Anchors

- `src/ts/stores.svelte.ts` (`ReloadGUIPointer.subscribe` sets
  `ReloadChatPointer` and calls `resetScriptCache()`).
- `src/lib/ChatScreens/Chat.svelte` (`displaya`, `ReloadGUIPointer.subscribe`,
  and the `{#key chatReloadPointer}` remount).
- `src/lib/ChatScreens/ChatBody.svelte` (`ParseMarkdown` call sites).
- `src/ts/process/scripts.ts` (`processScriptCache`,
  `compiledRegexCache`, `resetScriptCache`, `processScriptFull`).
- Harness precedents: `src/ts/__tests__/cloneCostHarness.ts`,
  `src/ts/process/__tests__/streamResponse.test.ts`, and the counting
  `RegExp` subclass technique in `src/ts/process/triggers.regexMemo.test.ts`.

## Target Shape

- Add `src/ts/__tests__/renderCostHarness.ts` or an equivalently named helper.
- The helper seeds N visible messages with stable, distinct display text.
- It instruments the parse entry points needed for H3/Phase 5 proofs:
  `ParseMarkdown`, `risuChatParser`, and `processScriptFull('editdisplay')`.
- It drives the reload path through `ReloadGUIPointer`, not by directly
  calling `resetScriptCache()`.
- It reports a small structured result, for example:
  `{ mountedMessages, parsesBeforeBump, parsesAfterBump, editDisplayRunsAfterBump, cacheWiped }`.
- It restores every spy/mock/global patch in `finally` or test teardown.

## Invariants

- No production instrumentation hooks or runtime flags.
- The harness must be deterministic under Vitest/jsdom and not require a real
  browser dev server.
- The helper should count full parse invocations, not elapsed time.
- Cache-wipe proof must observe the real `resetScriptCache()` effect on the
  script/regex caches.

## Done Criteria

- A focused harness smoke test can mount/simulate N messages, bump
  `ReloadGUIPointer`, and return counts without leaking mocks between tests.
- The smoke test proves the caches are warm before the bump and wiped after the
  bump.
- No baseline expectation is encoded yet beyond harness sanity.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/renderCostHarness.test.ts
```
