# Phase 6: Reactive Amplification & Render (Theme 6)

Status: pending.

Goal: stop the broad-dependency reactive consumers from doing
collection-sized work on every guarded projection write (the proxy re-mint,
I19, is the deliberate design and stays), and clear the remaining render-path
recompute/staleness items.

Findings: M6, L22, L28, L29, L30, L31, L32, L33.
Riding informational items: I12 (ModuleChatMenu derived, v2-L43 sibling),
I18 (`templateCheck` dependency narrowing) — both the same `$derived`
pattern, land them if free.

## Planned Slices

Author under `slices/phase-6-reactive-amplification-and-render/` when
starting.

- catalog-derived-lists (M6 + riding I12) — `$derived` + keyed each for the
  MobileCharacters sorted list (pure helper, unit-testable, mirroring
  `formatGridCatalogCharacterLists`/`sortModuleSettingsRows` and their gate
  tests); same one-liner for ModuleChatMenu if free.
- watcher-short-circuits (L28, L29) — reference-keyed lazy `localLore`
  snapshots in the character-scope lorebook watcher (a chat's localLore
  re-stringifies only when its array reference changed; full rollback
  coverage preserved — do NOT drop non-open chats), and a cheap sentinel
  short-circuit before the chat-metadata watcher's per-chat scalar Map
  rebuild (it currently fires per streaming render frame).
- draft-mirror-gating (L22) — gate the character-editor draft mirror's
  pick+clone+double-stringify on character switch / projection-apply epoch;
  split the read/seed effect so local keystrokes stop re-firing it.
- parse-memo-key-caching (L30) — cache the corpus-derived portions of the
  ChatBody parse-memo key (module/settings/character signatures) keyed by
  their cheap invalidation tokens (reload epoch, module id-join, chaId);
  build the detection key once per message and reuse it for the nested
  parse key.
- customhtml-template-memo (L31) — memoize the parsed `guiHTML` template per
  template version, shared across messages (its real invalidators are the
  `db.guiHTML`/cbs-condition reads).
- render-cache-hygiene (L32, L33) — cap `bestMatchCache` and reset it in
  `resetScriptCache()`; stop/null `bgmElement` on chat/character switch and
  clear stale observed bgm nodes.
- phase-6-verification-refresh — gates, render-count proofs, full
  validation, latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M6, L22, L28-L33 (the verifier corrections pin the true re-fire drivers
  and the safe fix shapes).
- M6: `src/lib/Mobile/MobileCharacters.svelte` (`sortChar`, `makeAgoText`),
  `src/lib/Others/GridCatalog.svelte` (default tab delegation);
  precedents `formatGridCatalogCharacterLists`, `sortModuleSettingsRows`
  + `GridCatalog.svelte.test.ts`/`ModuleSettings.svelte.test.ts`.
- L28: `src/ts/server/lorebookBridge.svelte.ts`
  (`collectCharacterLorebookSnapshots`, watcher effect).
- L29: `src/ts/server/chatBridge.svelte.ts` (`watchServerBackedChatMetadata`,
  `scalarChatMetadata`); hot driver `streamResponse.ts` render frames.
- L22: `src/ts/server/characterBridge.svelte.ts`
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

- The guard's whole-tree proxy re-mint (I19) is intentional and stays;
  every fix here is consumer-side (cheap keys, lazy snapshots, sentinels,
  derived memos).
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

- [ ] M6: catalog/mobile lists recompute once per corpus change (probe), not
      per render; keyed each in place; helper unit-tested.
- [ ] L28/L29: a lorebook keystroke re-stringifies only the edited
      collection; a streaming frame rebuilds no chat-metadata Map; external
      edits to any chat's localLore are still caught (coverage test).
- [ ] L22: editor keystrokes no longer re-run the pick+clone+stringify; a
      character switch or server push still re-seeds the draft.
- [ ] L30/L31: per-message key construction no longer serializes the corpus
      (probe); customHTML parses the template once per version; rendered
      output byte-identical.
- [ ] L32/L33: `bestMatchCache` capped and reset with its siblings; BGM
      stops on switch and the next chat's BGM starts.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/ChatScreens/ChatBody.parseMemo.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts
pnpm test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
