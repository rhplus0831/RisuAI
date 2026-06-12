# Slice: Render Cache Hygiene

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Findings:
L32 and L33. Client render/cache correctness and boundedness change.

## Scope

Bound and reset the dynamic-asset fuzzy-match cache, and make BGM observation
state follow the active chat/character instead of suppressing the next chat's
BGM.

This slice owns `bestMatchCache` in `scripts.ts` and `bgmElement` /
`observedControlNodes` behavior in `observer.svelte.ts`. It may add the small
chat-screen hook needed to reset BGM on active chat changes. It does not
change script execution output, dynamic asset matching rules, code-block
observer behavior, or non-BGM `risu-ctrl` behavior.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L32 and L33.
- `src/ts/process/scripts.ts`: `bestMatchCache`, `processScriptCache`,
  `compiledRegexCache`, `resetScriptCache`, and dynamic asset fuzzy matching
  around `HypaProcesser.similaritySearch`.
- `src/ts/process/scripts.regexCache.test.ts` and
  `src/ts/process/scripts.editdisplay.test.ts`: script cache and dynamic
  display-script coverage.
- `src/ts/observer.svelte.ts`: `bgmElement`, `observedControlNodes`,
  `nodeObserve`, `startObserveDom`, and `_resetDomObserverForTesting`.
- `src/ts/observer.svelte.test.ts`: observer idempotence tests to extend for
  BGM reset behavior.
- `src/lib/ChatScreens/Chat.svelte`: likely active chat/character switch hook
  for stopping previous BGM.

## Target Shape

- Apply the same bounded-cache discipline to `bestMatchCache` that
  `processScriptCache` and `compiledRegexCache` already use. Cap it at a
  fixed size, delete the oldest key on overflow, and keep match output
  unchanged for hits and misses.
- Clear `bestMatchCache` in `resetScriptCache()` with its sibling caches so
  asset definition changes cannot keep stale fuzzy matches alive.
- Add regression coverage for both cap eviction and reset clearing.
- Export or otherwise expose a narrow BGM reset helper from
  `observer.svelte.ts`. The helper should pause/stop the active audio,
  remove it when possible, null `bgmElement`, and clear stale BGM/control
  observation state so a new chat's BGM node can be processed.
- Call the BGM reset helper when the active chat or selected character
  changes. Use a compact key such as selected character id plus active chat id
  or chat page.
- Preserve same-chat idempotence: repeated observer scans of the same BGM
  node should still create one audio element.
- Register L32 and L33 as `DONE` in the v3 gate and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Dynamic asset replacements remain output-identical while a cache entry is
  present.
- Cache eviction may only remove old memo entries; it must not change the
  matching algorithm's selected best match for a fresh lookup.
- `resetScriptCache()` remains safe to call between script-definition changes
  and tests.
- Switching chats stops the previous BGM before the next chat's BGM starts.
- Code-block context menu idempotence remains unchanged.

## Done Criteria

- `bestMatchCache` is capped and evicts oldest entries past the cap.
- `resetScriptCache()` clears `bestMatchCache`, `processScriptCache`, and
  `compiledRegexCache`.
- A BGM in chat A is stopped/nulled on chat or character switch.
- A BGM in chat B can start after chat A's BGM was active.
- Same-node repeated scans still do not create duplicate audio.
- L32 and L33 are registered as `DONE` in the v3 gate and active-risk table,
  with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/scripts.regexCache.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/observer.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
