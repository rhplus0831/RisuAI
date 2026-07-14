# Phase 6: Reactive Amplification & Render (Theme 6)

Status: complete.

Goal: stop the broad-dependency reactive consumers from doing
collection-sized work on every guarded projection write (the proxy re-mint,
I19, is the deliberate design and stays), and clear the remaining render-path
recompute/staleness items.

v3 findings: M6, L22, L28, L29, L30, L31, L32, L33.
v4 amendments: v4-H1, v4-M1, v4-L20, v4-L22. v4-L23 is
measure-first/free-rider only if parser helper code is already touched.
Riding informational items: I12 (ModuleChatMenu derived, v2-L43 sibling),
I18 (`templateCheck` dependency narrowing) — both the same `$derived`
pattern, land them if free.

## Planned Slices

Authored under `slices/phase-6-reactive-amplification-and-render/`.

- [transcript-window-reset](slices/phase-6-reactive-amplification-and-render/transcript-window-reset.md)
  (v4-H1 + v4-L20) — reset or key transcript window state by active chat so a
  deep jump in one chat cannot mass-mount later chats; make jump/screenshot
  expansion bounded or transient instead of leaving a session-wide infinite
  window behind.
- [render-parser-dependency-narrowing](slices/phase-6-reactive-amplification-and-render/render-parser-dependency-narrowing.md)
  (v4-M1 + v4-L22; v4-L23 measure-first/free-rider) — narrow
  `Chat.svelte`/`BackgroundDom` parser dependencies so streaming-frame
  guarded writes do not re-run the full parser for every visible message or
  broad background HTML consumer.
- [catalog-derived-lists](slices/phase-6-reactive-amplification-and-render/catalog-derived-lists.md)
  (M6 + riding I12) — `$derived` + keyed each for the MobileCharacters sorted
  list (pure helper, unit-testable, mirroring
  `formatGridCatalogCharacterLists`/`sortModuleSettingsRows` and their gate
  tests); same one-liner for ModuleChatMenu if free.
- [watcher-short-circuits](slices/phase-6-reactive-amplification-and-render/watcher-short-circuits.md)
  (L28, L29) — reference-keyed lazy `localLore` snapshots in the
  character-scope lorebook watcher (a chat's localLore re-stringifies only
  when its array reference changed; full rollback coverage preserved — do
  NOT drop non-open chats), and a cheap sentinel short-circuit before the
  chat-metadata watcher's per-chat scalar Map rebuild (it currently fires per
  streaming render frame).
- [draft-mirror-gating](slices/phase-6-reactive-amplification-and-render/draft-mirror-gating.md)
  (v3-L22) — gate the character-editor draft mirror's
  pick+clone+double-stringify on character switch / projection-apply epoch;
  split the read/seed effect so local keystrokes stop re-firing it.
- [parse-memo-key-caching](slices/phase-6-reactive-amplification-and-render/parse-memo-key-caching.md)
  (L30) — cache the corpus-derived portions of the ChatBody parse-memo key
  (module/settings/character signatures) keyed by their cheap invalidation
  tokens (reload epoch, module id-join, chaId); build the detection key once
  per message and reuse it for the nested parse key.
- [customhtml-template-memo](slices/phase-6-reactive-amplification-and-render/customhtml-template-memo.md)
  (L31) — memoize the parsed `guiHTML` template per template version, shared
  across messages (its real invalidators are the `db.guiHTML`/cbs-condition
  reads).
- [render-cache-hygiene](slices/phase-6-reactive-amplification-and-render/render-cache-hygiene.md)
  (L32, L33) — cap `bestMatchCache` and reset it in `resetScriptCache()`;
  stop/null `bgmElement` on chat/character switch and clear stale observed
  bgm nodes.
- [phase-6-verification-refresh](slices/phase-6-reactive-amplification-and-render/phase-6-verification-refresh.md)
  — gates, render-count proofs, full validation, latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M6, v3-L22, L28-L33 (the verifier corrections pin the true re-fire drivers
  and the safe fix shapes).
- [`../../v4/audit-stability-and-performance-v4.md`](../../v4/audit-stability-and-performance-v4.md) -
  v4-H1/v4-L20 transcript window reset and screenshot bound,
  v4-M1/v4-L22 parser dependency narrowing, and v4-L23 measure-first helper
  churn.
- [`../v4-integration-brief.md`](../v4-integration-brief.md) - post-Phase-4
  routing that starts Phase 6 with the v4 render/window batch.
- v4-H1/v4-L20: `src/lib/ChatScreens/DefaultChatScreen.svelte`
  (`loadPages`, `scrollToMessage`, `screenShot`),
  `src/lib/ChatScreens/Chats.svelte`, `src/lib/ChatScreens/ChatScreen.svelte`,
  `src/lib/Others/BookmarkList.svelte`.
- v4-M1/v4-L22: `src/lib/ChatScreens/Chat.svelte`
  (`$effect.pre`, `displaya`, `getCbsCondition`),
  `src/lib/ChatScreens/BackgroundDom.svelte`,
  `src/lib/ChatScreens/ChatBody.svelte` as the prop-scoped precedent,
  `src/ts/process/postGeneration/streamResponse.ts` as the hot guarded-write
  driver.
- M6: `src/lib/Mobile/MobileCharacters.svelte` (`sortChar`, `makeAgoText`),
  `src/lib/Others/GridCatalog.svelte` (default tab delegation);
  precedents `formatGridCatalogCharacterLists`, `sortModuleSettingsRows`
  and `GridCatalog.svelte.test.ts`/`ModuleSettings.svelte.test.ts`.
- L28: `src/ts/server/lorebookBridge.svelte.ts`
  (`collectCharacterLorebookSnapshots`, watcher effect).
- L29: `src/ts/server/chatBridge.svelte.ts` (`watchServerBackedChatMetadata`,
  `scalarChatMetadata`); hot driver `streamResponse.ts` render frames.
- v3-L22: `src/ts/server/characterBridge.svelte.ts`
  (`createServerBackedCharacterDraft` first `$effect`).
- L30: `src/lib/ChatScreens/ChatBodyParseMemo.ts`
  (`getChatBodyParseMemoKey`, `getChatBodyCachedOnlyLlmDetectionKey`),
  `ChatBody.svelte` (`markParsingResult`).
- L31: `src/lib/ChatScreens/Chat.svelte` (customHTML branch,
  `RenderGUIHtml`).
- L32: `src/ts/process/scripts.ts` (`bestMatchCache` vs the capped
  `processScriptCache`/`compiledRegexCache` + `resetScriptCache`).
- L33: `src/ts/observer.svelte.ts` (`nodeObserve` bgm case,
  `observedControlNodes`).
- I19 (context, no change): `src/ts/server/projectionWriteGuard.svelte.ts`.
- I18 (riding): `src/lib/Setting/Pages/PromptSettings.svelte`
  (`templateCheck` effect).

## Planned Shape

- Start Phase 6 with v4-H1/v4-L20 and v4-M1/v4-L22 before the lower-impact
  render lows. These are the highest user-visible Phase 6 amplifiers and
  should be closed while the render/window context is fresh.
- The guard's whole-tree proxy re-mint (I19) is intentional and stays;
  every fix here is consumer-side (cheap keys, lazy snapshots, sentinels,
  derived memos).
- Active-chat-owned UI state must either reset on identity change or be keyed
  by identity. A bookmark jump may expand the current chat's window, but that
  expansion must not survive into another chat. Screenshot expansion must be
  bounded or restored in a cleanup path after capture.
- Parser effects must depend on message/background inputs, not broad
  projection proxy identity. A guarded streaming-frame write may re-parse the
  streaming row or a changed background, but not every visible message and not
  `BackgroundDom` on unrelated writes.
- v4-L23 (`Intl.DateTimeFormat` helper churn) is not mandatory Phase 6 work.
  Only fix or measure it if `risuChatParserHelpers.ts` is already touched by
  the parser-dependency slice or a profile makes it visible.
- L28 must keep full coverage: the watcher still catches rollback/external
  replacements to non-open chats' localLore (the audit's correction
  explicitly rejects per-open-chat tracking).
- L29's mounts share one ref-counted effect; the fix is a short-circuit, not
  mount de-duplication.
- L30: on reload-epoch bumps the parse itself legitimately re-runs (the
  epoch is in the key); the pure-overhead target is epoch-unchanged
  re-renders and the duplicated signature serialization per message.
- All memo/derived fixes are output-identical; render-count/clone-count
  probes are the proof currency.

## Exit Criteria

- [x] v4-H1/v4-L20: `loadPages` or equivalent transcript-window state resets
      or keys on active chat identity; a deep bookmark jump in chat A does not
      mass-mount chat B; screenshot/jump expansion is bounded or transient and
      leaves no standing `Infinity`/whole-transcript window after cleanup.
- [x] v4-M1/v4-L22: guarded streaming-frame writes no longer call
      `risuChatParser` for every visible `Chat.svelte` row or re-run
      `BackgroundDom` parsing on unrelated projection writes; parser/render
      call-count tests cover both surfaces.
- [x] M6: catalog/mobile lists recompute once per corpus change (probe), not
      per render; keyed each in place; helper unit-tested.
- [x] L28/L29: a lorebook keystroke re-stringifies only the edited
      collection; a streaming frame rebuilds no chat-metadata Map; external
      edits to any chat's localLore are still caught (coverage test).
- [x] v3-L22: editor keystrokes no longer re-run the pick+clone+stringify; a
      character switch or server push still re-seeds the draft.
- [x] L30/L31: per-message key construction no longer serializes the corpus
      (probe); customHTML parses the template once per version; rendered
      output byte-identical.
- [x] L32/L33: `bestMatchCache` capped and reset with its siblings; BGM
      stops on switch and the next chat's BGM starts.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/lib/ChatScreens/Chat.parserDependencies.test.ts \
  src/lib/ChatScreens/BackgroundDom.parserDependencies.test.ts \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts \
  src/lib/ChatScreens/ChatBody.parseMemo.test.ts \
  src/lib/ChatScreens/Chat.customHtml.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/process/scripts.regexCache.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/observer.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
