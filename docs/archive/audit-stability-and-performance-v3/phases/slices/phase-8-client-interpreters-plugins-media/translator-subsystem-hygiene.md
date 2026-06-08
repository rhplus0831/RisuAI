# Slice: Translator Subsystem Hygiene

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
v4-L24, v4-L25, v4-L26, v4-L27, v4-L28, and v4-L29. Client translator
boundedness and remount-cost change.

## Scope

Close the bounded translator hygiene batch introduced by the v4 audit without
turning Phase 8 into a catch-all optional-subsystem sweep.

This slice owns translator output memoization, edit-translation regex
memoization, the LLM translation cache policy and quota behavior, deeplX
delimiter-mismatch fallback classification, and `combineTranslation` fanout.
It does not own the v4-L30 projection-guard break in
`getCurrentTranslatorPreset()`; keep that routed to Phase 5's guarded-write
and feature-breakage sweep. It also does not own stage-4 image generation,
MCP handshake failure, filesystem MCP reads, inlay image decompression bounds,
plugin guest listener cleanup, or DPoP keypair recovery.

## Anchors

- [`../../../../../audit-stability-and-performance-v4.md`](../../../../../audit-stability-and-performance-v4.md)
  v4-L24 through v4-L29 under "Client -- translator subsystem".
- [`../../../v4-integration-brief.md`](../../../v4-integration-brief.md):
  Phase 8 amendment routing for the translator slice and Phase 5 routing for
  v4-L30.
- `src/ts/translator/translator.ts`: `translateHTML`, `translateNode`,
  `translateNodeText`, `applyEdittransRegex`, `LLMCacheStorage`, `waitTrans`,
  deeplX delimiter fallback, and `combineTranslation`.
- `src/lib/ChatScreens/ChatBody.svelte`: translation call sites and existing
  translated/detection gating around message remounts.
- `src/ts/translator/translator.html.test.ts`,
  `src/ts/translator/translator.cache.test.ts`, and
  `src/lib/ChatScreens/ChatBody.parseMemo.test.ts`: focused proof homes for
  HTML translation, cache behavior, and remount call-count coverage.
- `src/ts/translator/presets.ts` and
  `src/ts/translator/presets.test.ts`: Phase 5 context only for v4-L30. Do
  not mark that guard fix complete from this slice.

## Target Shape

- Add an output memo around `translateHTML` results so remounting an already
  translated message does not re-run DOM parsing, recursive node walking,
  XML serialization, edit-translation scripts, or LLM cache lookups when the
  input and translator settings signature are unchanged.
- Keep the memo key explicit and invalidatable. It must include the source
  HTML and every translator setting or script input that can change output:
  translator type, source/target language, auto-translation options,
  `combineTranslation`, edit-translation script generation, character
  override inputs, regenerate/explicit-retranslate state, and any local
  prompt fields used by translator output.
- Bound the output memo with a small LRU or an equivalent per-message cache
  lifetime. A chat switch, settings change, script change, or explicit
  regenerate must not reuse stale translation output.
- Memoize compiled edit-translation regexes by script identity and pattern.
  Invalid patterns should surface through the existing error path once per
  relevant script/version, not recompile and rethrow for every translated
  message render.
- Replace the unbounded `LLMTranslateCache` write path with an explicit cache
  quota policy: fixed upper bound, LRU/prune behavior, and a cache-write
  failure path that does not turn a successful translation into repeated
  error modals for every new segment.
- Handle `QuotaExceededError` and equivalent localforage write failures at
  the translator cache boundary. Cached reads should continue to work; failed
  writes should be reported once or degraded to uncached output without
  re-requesting the same paid translation on every remount.
- Treat deeplX delimiter-mismatch fallback as measure/guard first. Either add
  a bounded fallback with a cap on per-message one-by-one calls and
  rate-limiter waits, or record a focused measurement/no-action decision that
  explains why the opt-in path is deferred. Do not patch one delimiter case
  while leaving an unbounded N-fragment retry shape.
- Make `combineTranslation` match its advertised batching behavior or
  otherwise bound fanout. A multi-line paragraph must not issue one network
  translate call plus one edit-display script pass per `<br>` fragment when
  the combined path is enabled.
- Keep v4-L30 explicitly out of this slice. If LLM translator tests need to
  run before Phase 5 lands the preset getter fix, use safe fixtures/mocks or
  record the dependency; do not normalize by writing through the read-only
  projection in this Phase 8 slice.

## Inventory And Allowlist Expectations

Before implementation, run and record a translator-local inventory for:

- cache sites: `LLMCacheStorage`, output memo storage, regex memo storage, and
  any localforage calls in `src/ts/translator/`;
- listener/timer sites: the deeplX `waitTrans` limiter and any new timers used
  for cache pruning, fallback deadlines, or delayed cleanup;
- blob/audio/object URL sites: expected none in the translator slice, but any
  discovered or newly added site must be listed and paired with cleanup or an
  explicit no-action reason;
- debug-log sites: translator note or payload logs are already allowed to ride
  the Phase 8 media-log sweep; if touched here, classify each as removed,
  gated with a default-off debug flag, or intentionally retained with reason.

Every listed site must end in one of three states in the slice proof text:
fixed, no-actioned with a reason, or measured/deferred with an owner and the
evidence needed to revisit it. Do not expand this slice to all client
localforage stores or every optional translator provider unless the named
translator cache/timer/log invariant covers the site.

## Invariants

- Successful translation output remains byte-compatible unless the current
  behavior is the documented fanout/fallback bug being fixed.
- Explicit retranslate/regenerate bypasses stale memo entries and refreshes
  the relevant cache state.
- Cache bounds and quota handling must not drop already-rendered translated
  output from the current render.
- Cache keys must not mix translator modes, target languages, characters,
  script generations, or prompt settings.
- A cache write failure is not a translation failure unless the underlying
  translator request failed.
- Translator fixes must not flip v3 Phase 8 M7, L38-L55, or K4 to `DONE`.

## Done Criteria

- Repeated remounts of the same translated message reuse memoized output, with
  call-count proof showing no repeated DOM walk / LLM cache lookup work until
  the translation signature changes.
- Edit-translation scripts compile regexes once per script/version and reuse
  the compiled form across translated messages.
- `LLMTranslateCache` has a bounded retention policy, deterministic eviction
  or prune behavior, and focused quota-error coverage.
- Quota or localforage `setItem` failure does not create a repeating
  per-segment error-modal chain on subsequent renders.
- deeplX delimiter mismatch is either bounded by a tested guard or explicitly
  measured/deferred with the fallback call count and wait cost recorded.
- `combineTranslation` no longer fans a multi-line paragraph into unbounded
  per-line translate and edit-display work, or the remaining fanout is capped
  and documented.
- v4-L30 remains routed to Phase 5; this slice records the dependency if LLM
  mode cannot be fully proved before that fix lands.
- No v3 active-risk statuses are changed, and no existing Phase 8 v3 IDs are
  marked `DONE` by this translator-only work.

## Validation

```bash
pnpm exec vitest run \
  src/ts/translator/translator.html.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/lib/ChatScreens/ChatBody.parseMemo.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

## Implementation Proof Notes

Status: v4-L24 through v4-L29 fixed in translator-local code. v4-L30 remains
Phase 5-owned and no v3 active-risk status IDs are flipped by this slice.

Inventory:

- Cache sites: the existing `translateCache` remains bounded and now keys on
  translator settings; `translateHTML` has a bounded output memo; edit-translation
  regex compilation has bounded valid/invalid memo storage; `LLMCacheStorage`
  has a fixed entry limit, deterministic pruning, signature-aware auto-LLM keys,
  and a bounded volatile fallback for persistent write failures. The Bergamot
  model cache is no-actioned because it stores finite model assets, not per-output
  translation results.
- Listener/timer sites: no new listeners or timers were added. The existing
  deeplX `waitTrans` limiter remains, and delimiter-mismatch fallback is capped
  per message at `DEEPLX_DELIMITER_FALLBACK_MAX_SEGMENTS` one-by-one calls
  across all batched flushes, bounding any limiter wait amplification.
- Blob/audio/object URL sites: no Blob or object URL sites exist in the
  translator slice. `new Audio(sendSound)` remains no-actioned; memoized remounts
  intentionally do not replay the completion sound.
- Debug-log sites: the LLM translator-note `console.log` calls were removed.

Focused proof added:

- `translator.html.test.ts`: output memo remount/invalidation/regenerate proof,
  combined paragraph fanout proof, edittrans regex valid/invalid memo proof, and
  deeplX fallback cap proof.
- `translator.cache.test.ts`: translator-settings cache-key proof, LLM signature
  separation, deterministic LLM cache pruning, and quota-failure volatile fallback
  proof.
