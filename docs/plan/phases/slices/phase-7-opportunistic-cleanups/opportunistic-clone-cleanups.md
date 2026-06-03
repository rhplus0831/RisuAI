# Opportunistic Clone Cleanups

Status: planned. Phase 7. A batch of small, independent, behavior-preserving
cleanups; land them opportunistically.

## Scope

The audit's Low-severity items: shallow-spread clones, a scalar character
baseline, regex memoization, an algorithmic rewrite, a stray render-path log, and
a folder/chat scan reduction. None is a freeze risk; each is a cheap, safe
reduction recorded so it is not lost.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Low findings and the clone-site inventory.
- `src/ts/cbs.ts:364/376/399/1687`, `src/ts/observer.svelte.ts:118`,
  `src/ts/characters.ts:138/195/220/242/259`, `src/ts/process/scripts.ts:215`,
  `src/ts/parser/risuChatParser.ts:638`, `src/lib/ChatScreens/ChatBody.svelte:208`,
  `src/lib/SideBars/SideChatList.svelte:444`,
  `src/lib/Setting/Pages/PersonaSettings.svelte:68`.

## Items

| Item | Fix |
| --- | --- |
| CBS `{{history}}`/`{{charhistory}}`/`{{userhistory}}` (`cbs.ts:376/399/1687`) | Shallow-copy + reparse only `.data`: `JSON.stringify({ ...v, data: risuChatParser(v.data, matcherArg) })`; drops the `structuredClone`/rfdc overhead. The live `DBState` Message must not be mutated — the spread preserves that. No memo cache. |
| Claude observer body (`observer.svelte.ts:118`) | Shallow spread: `lastClaudeObserverPayload = { ...arg.body, max_tokens: 10 }` (drop the separate clone + assignment). Gated behind the OFF-by-default experimental flag; trivial. |
| Character image/emotion (`characters.ts:138/195/220/242/259`) | Replace `currentCharacterStateSnapshot()` + `cloneCharacterSnapshot(full character)` with a single-character scalar baseline keyed by `chaId` (reuse the Phase 0 `CharacterRowSnapshot`), capturing only `image`/`ccAssets`/`emotionImages`/`extentions.pngExif`; `CHARACTER_PATCH_EXCLUDED_KEYS` already excludes `chats`. |
| Per-token regex recompile (`scripts.ts:215`) | Memoize compiled `RegExp` per regex-script source instead of recompiling per `executeScript`. |
| `{{#each}}` re-injection (`risuChatParser.ts:638`) | Rewrite the per-element splice-into-source + re-scan to avoid the O(da.length) re-injection (template-bounded, opt-in). |
| Per-render `console.log` (`ChatBody.svelte:208`) | Remove the `console.log` of the full assets array for every `<img>` in every rendered message. |
| `SideChatList` folder/chat scan (`:444`) | Reduce the O(folders×chats) + O(chats²) `filter`/`indexOf` to a single pass with identical ordering. |
| Personas double clone (`PersonaSettings.svelte:68`) | (Optional, sub-ms) drop one of the two per-keystroke `cloneJsonValue(DBState.db.personas)` passes. |

## Behavior / Invariants

- CBS render text, prompt assembly, persisted state, and rendered DOM order are
  byte-/order-identical.
- The image/emotion rollback still restores the mutated avatar/emotion fields on
  failure (reuse the `CharacterRowSnapshot` correctness property).
- The `{{#each}}` rewrite produces identical output for nested and flat templates.

## Done When

- Each item is shallow-spread / scoped / memoized / removed per the table; no
  behavioral change is observable.
- The per-render `console.log` is gone; the `SideChatList` scan is single-pass.
- `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/cbs` and the per-file suites for the touched items.
- `pnpm test`
- `pnpm client-thinning:audit`
