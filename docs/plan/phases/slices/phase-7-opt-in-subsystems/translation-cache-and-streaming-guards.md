# Slice: Translation Cache And Streaming Guards

Phase: [7](../../phase-7-opt-in-subsystems.md). Findings: M15, M16. Runtime
change.

## Scope

Replace the auto-translate render cache's parallel arrays with bounded O(1)
lookups, and stop Google/default auto-translate from re-parsing, re-fetching,
and logging full message HTML while a message is streaming.

This slice does not own bergamot promise-chain recovery, translated-suggestion
races, or `markParsing` retry policy. Those are separate Phase 7 slices.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M15 and M16.
- `src/ts/translator/translator.ts`: `cache`, `translate`, `runTranslator`,
  `isExpTranslator`, `translateHTML`, and the DOM-walk `console.log(html)`.
- Streaming caller: `src/lib/ChatScreens/ChatBody.svelte`.
- Existing translator suite: `src/ts/translator/presets.test.ts`.
- New focused test homes:
  `src/ts/translator/translator.cache.test.ts`,
  `src/ts/translator/translator.html.test.ts`.

## Target Shape

- Replace `{ origin: string[]; trans: string[] }` with a bounded `Map` keyed by
  direction and text, such as `${reverse}|${text}`. A small LRU helper is
  enough; keep the cap module-local and explicit.
- Make cache hit, insertion, de-duplication, and eviction O(1). When an entry is
  touched, refresh its recency; when the cap is exceeded, evict the oldest key
  deterministically.
- Preserve reverse lookups by storing the result for the requested direction
  instead of relying on parallel-array position.
- Reset or namespace the cache on chat switch so a long prior chat does not
  keep growing the active session's translate cache.
- Remove `console.log(html)` and any live translate-chunk payload logs from the
  `translateHTML` default DOM-walk path.
- Extend the `DoingChat` suppression so non-exp translators, especially the
  default Google path, return the unmodified HTML during streaming instead of
  translating every render frame. Preserve the existing LLM cached-translation
  exception.
- Add tests proving repeated lookups do not re-run the translator, the cache is
  capped, eviction is deterministic, reverse and forward directions do not
  collide, chat switching clears or isolates entries, and streaming Google
  auto-translate performs zero DOM parser/fetch/log work.
- Register M15 and M16 as `DONE` in the v2 gate with focused tests, and flip
  both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Successful translation text stays identical for forward and reverse calls.
- Media/raw/video/audio line splitting in `runTranslator` is unchanged.
- LLM/deepl/deeplX behavior outside active streaming is unchanged.
- The streaming guard must not suppress explicit regenerate/cached LLM work
  that already has a cache hit.
- No warm render path writes full message HTML or translation chunks to
  `console.log`.

## Done Criteria

- Auto-translate lookup cost is O(1), bounded by the configured cap, and does
  not grow across chat switches.
- A default-Google streaming message does not invoke `DOMParser`, `fetch`, or
  `console.log` from `translateHTML`.
- M15 and M16 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/translator/translator.cache.test.ts src/ts/translator/translator.html.test.ts src/ts/translator/presets.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
