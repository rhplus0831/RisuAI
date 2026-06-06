# Slice: ChatBody Content-Keyed Parse Memo

Phase: [5](../../phase-5-client-render-and-ui.md). Findings: M17, L40.
Depends on Phase 1 H3 and the Phase 0 render-count harness. Runtime change.

Status: complete; proof refreshed in
[`phase-5-verification-refresh.md`](phase-5-verification-refresh.md).

## Scope

Add a bounded module-level memo for `ChatBody` markdown parsing and LLM
cached-only translate detection so unchanged visible messages do not re-run
`ParseMarkdown` across remounts or equivalent re-derivations.

This slice does not own the H3 remount narrowing itself, the translator cache
LRU from Phase 7, or any change to translated output semantics.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M17 and L40.
- `src/lib/ChatScreens/ChatBody.svelte`: `markParsing`,
  instance-local `lastCharArg`/`lastChatId`, `getCbsCondition`, the
  `ParseMarkdown` call sites, `getLLMCache`, and `checkImg`.
- `src/lib/ChatScreens/Chat.svelte`: `{#key}` around `ChatBody` and the
  Phase 0/H3 render-count proof path.
- `src/ts/parser/parser.svelte.ts`: `ParseMarkdown`,
  `postTranslationParse`, and parse-affecting flags.
- `src/ts/process/scripts.ts`: script and regex cache reset behavior that H3
  narrows.
- Phase 0 helper/test: `src/ts/__tests__/renderCostHarness.ts` and
  `src/ts/__tests__/renderCountBaseline.test.ts`.
- New focused test home:
  `src/lib/ChatScreens/ChatBody.parseMemo.test.ts` or a helper-level
  equivalent under `src/ts/parser/`.

## Target Shape

- Introduce a module-level helper for `ChatBody` parse work. It may live beside
  `ChatBody.svelte` or in a small TS helper, but it must survive component
  instance destruction.
- Cache in-flight and resolved `ParseMarkdown` promises by a content signature
  that includes at least message content, `chatID`, parse mode,
  `CbsConditions`, a character/script/asset identity signature, and the
  parse-affecting settings or epoch needed to avoid stale output after real
  definition changes.
- Keep the memo bounded with a small LRU/window cap so long sessions do not
  accumulate one entry per historical message forever.
- Reuse the same memo for the M17 cached-only pre-translate detection parse.
  Cache the final "LLM cache exists" decision separately when useful, keyed by
  content plus the translate settings that affect the lookup.
- Preserve explicit `retranslate`: it may reuse raw/pretranslated parse
  output, but it must not suppress a user-requested translation refresh.
- Keep per-instance stale-result protection so a slower parse/translation
  promise cannot write an older result into a newer render.
- Extend the render-count proof so unchanged message re-derivation produces
  zero `ParseMarkdown` calls, including across a simulated GUI reload/remount,
  while changed content misses the memo.
- Register M17 and L40 as `DONE` in the v2 gate with render-count/cache tests,
  and flip both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Changed message content, changed parse mode, changed chat id, changed
  character script/assets, or true script/module/settings-definition reloads
  must invalidate the memo.
- Variable-only GUI updates should not invalidate the memo once H3 has
  separated them from definition-level reloads.
- LLM cached-only mode must still read the LLM cache when the detection key is
  new, and must still leave `translated` false when no cached translation
  exists.
- `checkImg()` and post-render asset resolution behavior must remain
  unchanged.

## Done Criteria

- An unchanged visible message re-derived after a simulated GUI reload performs
  zero full `ParseMarkdown` runs.
- Editing the message content or parse-affecting character data performs a new
  parse and updates the rendered HTML.
- LLM cached-only translate detection no longer performs an extra parse on a
  memo hit, and duplicate in-flight detections share work.
- M17 and L40 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts src/lib/ChatScreens/ChatBody.parseMemo.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm check
pnpm exec tsc -p tsconfig.client-lib.json
```
