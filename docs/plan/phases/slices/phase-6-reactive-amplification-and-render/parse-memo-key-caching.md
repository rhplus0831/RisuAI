# Slice: Parse Memo Key Caching

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Finding:
L30. Client render/parse key performance change.

## Scope

Cache the corpus-derived pieces of ChatBody parse-memo key construction and
avoid constructing the nested parse key twice for cached-only LLM detection.

This slice owns `ChatBodyParseMemo.ts` and the `ChatBody.svelte` call path
that builds parse and detection keys. It does not change parser output,
translation behavior, reload-epoch invalidation, image repair, or cache
lookup semantics.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L30.
- `src/lib/ChatScreens/ChatBodyParseMemo.ts`:
  `getChatBodyParseMemoKey`,
  `getChatBodyCachedOnlyLlmDetectionKey`, `characterSignature`,
  `moduleSignature`, `parseSettingsSignature`, `activeChatSignature`, and
  `stableStringify`.
- `src/lib/ChatScreens/ChatBody.svelte`: `markParsingResult` and
  `markParsing`.
- `src/ts/stores.svelte`: `ReloadGUIPointer`, `CurrentTriggerIdStore`, and
  active chat/character stores used by the key.
- Focused test: `src/lib/ChatScreens/ChatBody.parseMemo.test.ts`.

## Target Shape

- Memoize the corpus-derived signatures by cheap invalidation tokens rather
  than by the broad proxy identities reminted by I19.
- At minimum cover the expensive signatures identified by the audit:
  module/script/asset signature, settings/regex signature, and character
  signature. Use invalidators such as reload epoch, current trigger id,
  module id join/version, selected character id/`chaId`, and any existing
  mutation epochs that already express the same dependencies.
- Keep message-local inputs (`data`, `chatID`, `mode`, `cbsConditions`) in the
  final key so per-message cache correctness is unchanged.
- Preserve reload-epoch behavior: when `ReloadGUIPointer` changes, the key
  changes and parsing legitimately re-runs for loaded messages.
- For epoch-unchanged re-renders, avoid re-serializing the whole
  script/module/regex/settings corpus per message.
- Build the detection parse key once per message. Acceptable shapes include
  adding an optional precomputed parse key parameter to
  `getChatBodyCachedOnlyLlmDetectionKey`, or returning both parse and
  detection keys from a shared helper.
- Keep stable string bytes identical for equivalent input objects so existing
  caches continue to hit.
- Register L30 as `DONE` in the v3 gate and flip only the L30 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Parser output and rendered HTML are byte-identical for the same inputs.
- Reload epoch remains a real invalidator.
- A changed module, regex, asset setting, character field, or active chat
  signature must still change the parse key.
- Cached-only LLM detection mode selection remains unchanged.
- Memo caches must not grow without bound if keyed by dynamic ids or epochs.

## Done Criteria

- A focused regression proves corpus-derived signature serialization happens
  once per invalidation token change, not once or twice per rendered message.
- `getChatBodyCachedOnlyLlmDetectionKey` reuses a prebuilt parse key for the
  nested non-raw detection path.
- Tests cover an unchanged re-render, a reload-epoch bump, and at least one
  real corpus invalidator.
- L30 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/ChatBody.parseMemo.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
