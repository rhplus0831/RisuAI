# Phase 8: Client Interpreters, Plugins & Media (Theme 8)

Status: complete.

Goal: the hygiene ring 3 — port the server's execution budgets to the client
interpreters, fix the plugin/MCP lifecycle leaks and caps, and clear the
media/files leak-and-log cluster the v2 phase-7 sweep did not reach.

Findings: M7, L38-L55, K4.
v4 amendments: v4-L24 through v4-L29, v4-L31, and v4-L35 through v4-L37 ride
Phase 8 only through the bounded translator/MCP/media/plugin invariants below.
v4-L30 stays in Phase 5 because it is a projection-guard write break. v4-L38
is an auth-storage quota/recovery risk; keep it out of Phase 8 unless a named
storage-persistence owner accepts it with a measure/defer note.
Riding informational items: I16/I17 (TTS + LLM-translator logs, same sweep
as L50) — land if free.

## Completed Slices

Authored under `slices/phase-8-client-interpreters-plugins-media/`.

- [client-interpreter-budgets](slices/phase-8-client-interpreters-plugins-media/client-interpreter-budgets.md)
  (L38, L39, L40, L41) - port `TriggerExecutionBudget` caps + abort to the
  client `runTrigger` (the live unbounded entry is `manual` mode: `/trigger`
  command and in-message trigger buttons); install the wasmoon
  instruction-count hook + wall-clock deadline on client Lua engines; key the
  engine cache on `(mode, codeHash)`; delete the editDisplay access key in a
  `finally`.
- [tokenizer-and-cache-caps](slices/phase-8-client-interpreters-plugins-media/tokenizer-and-cache-caps.md)
  (L42) - LRU-bound `googleCloudTokenizedCache` (or fold into
  `encodeCache`).
- [translator-subsystem-hygiene](slices/phase-8-client-interpreters-plugins-media/translator-subsystem-hygiene.md)
  (v4-L24 through v4-L29) - add a bounded translator subsystem sweep: memoize
  `translateHTML` output and edit-translation regex compilation, bound and
  quota-harden the LLM translation cache, measure or guard deeplX fallback
  fanout, and make `combineTranslation` honor its batching intent. Explicitly
  leave v4-L30 to Phase 5.
- [plugin-lifecycle](slices/phase-8-client-interpreters-plugins-media/plugin-lifecycle.md)
  (M7, L43, L44) - store `run()`'s cleanup closure on the SandboxHost
  instance and invoke it from `terminate()`; reset/dedupe the custom-provider
  stores on plugin reload; remove V3 guest document listeners and
  `SafeMutationObserver`s on unload/reload (v4-L37); gate or remove the RPC
  console logs (never log transferables).
- [mcp-lifecycle-and-caps](slices/phase-8-client-interpreters-plugins-media/mcp-lifecycle-and-caps.md)
  (L45, L46, L47, L48) - compute tools lazily only in the browser-local
  adapters; in-flight construction promise per MCP key; size-cap the
  persistent `connectSSE` buffer; page/byte caps + AbortSignal + honored
  `limit` in the filesystem PDF read; add v4-L35 only through the same
  cap/clean-failure invariant for filesystem base64 reads and content search.
- [file-attach-await](slices/phase-8-client-interpreters-plugins-media/file-attach-await.md)
  (L49) - `await hypa.addText(...)` at the three builders (one-token fixes;
  update the test that mocks `addText` synchronously).
- [media-leaks-and-logs](slices/phase-8-client-interpreters-plugins-media/media-leaks-and-logs.md)
  (L50, L51, L52, L53, L54, L55, K4 + riding I16/I17) - remove the image-gen
  payload logs; revoke object URLs in `finally` at the image-processing sites
  (incl. the `scriptings.ts` siblings); shared/closed AudioContext for
  `runVITS` + decode error callback; dispose the VITS synthesizer on model
  switch; `pdf.destroy()` in `finally`; close the whisper-mode contexts and
  revoke the probe URL; `onerror` + timeout for the stableDiff reference-image
  load; add v4-L31 and v4-L36 only through abort/cap criteria for imggen
  post-generation polling and model/proxy image decode.
- [phase-8-verification-refresh](slices/phase-8-client-interpreters-plugins-media/phase-8-verification-refresh.md)
  - gates, focused proofs, full validation, latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M7, L38-L55; K4 under Known-Item Overlaps.
- L38/L39/L40/L41: `src/ts/process/triggers.ts` (client `runTrigger`),
  `src/ts/process/scriptings.ts` (engine create/cache, access-key cleanup);
  server precedents `server/fastify/src/prompt/triggers.ts`
  (`TriggerExecutionBudget`) and `prompt/luaRuntime.ts` (count hook).
- L42: `src/ts/tokenizer.ts` (`googleCloudTokenizedCache` vs `encodeCache`).
- M7/L43/L44: `src/ts/plugins/apiV3/factory.ts` (SandboxHost),
  `v3.svelte.ts` (`executePluginV3`, `unloadV3Plugin`, provider stores),
  `plugins.svelte.ts` (`loadV2Plugin` reset block).
- L45/L46/L47/L48: `src/ts/process/request/request.ts` (`getTools` call),
  `serverCompletion.ts`, `src/ts/process/mcp/mcp.ts` (`initializeMCPs`),
  `mcplib.ts` (`connectSSE`), `filesystemclient.ts` (`readFileAsPDF`),
  `src/ts/process/dynamicutils/pdf.ts` (`convertPdfToImages`).
- L49: `src/ts/process/files/multisend.ts` (the three builders),
  `src/ts/process/memory/hypamemory.ts` (`addText`); awaiting precedents
  `postGeneration/emotionFallbackEmbedding.ts`, `embedding/addinfo.ts`.
- L50-L55/K4: `src/ts/process/stableDiff.ts`, `files/inlays.ts`,
  `processzip.ts` (`writeJpeg`), `scriptings.ts` (sibling URL sites),
  `transformers.ts` (`runVITS`, synthesizer), `dynamicutils/pdf.ts`,
  `src/lib/Playground/PlaygroundSubtitle.svelte`; precedents
  `tts.ts` (`getNetworkAudioContext`), the v2-L49 `inlays.ts` guard shape.
- v4 translator/MCP/media/plugin amendments:
  `src/ts/translator/translator.ts`,
  `src/ts/translator/presets.ts`,
  `src/ts/process/postGeneration/runStage4.ts`,
  `src/ts/process/stableDiff.ts`,
  `src/ts/process/mcp/filesystemclient.ts`,
  `src/ts/process/files/inlays.ts`,
  and `src/ts/plugins/apiV3/v3.svelte.ts`. v4-L30 remains Phase 5.

## Planned Shape

- Client budget ports must thread abort from the live entrypoints (the
  manual `/trigger` command path), not the dead output-trigger arm — the
  audit's liveness corrections name the live callers.
- The Lua deadline must throw into the existing catch (the engine-level
  hook), not freeze; budget defaults mirror the server constants.
- Plugin/MCP fixes are lifecycle-correctness: every add gets a paired
  remove; every check-then-await-then-assign gets an in-flight promise.
- v4 additions use inventories, not blanket ownership: every added
  translator/MCP/media/plugin cache, listener, timer, blob URL, audio context,
  and debug-log site must be fixed, explicitly no-actioned with a reason, or
  measured/deferred with an owner. Do not expand Phase 8 to optional
  subsystems that do not match an abort/cap/lifecycle/log invariant.
- L49 is silent-data-loss repair: the `<File>` block must contain the
  attached file's content deterministically; fix the synchronous-mock test
  that hides the race.
- Media fixes follow the existing in-repo patterns (shared context, revoke
  in finally, dispose-before-replace); K4 copies the landed v2-L49 guard.

## Exit Criteria

- [x] L38/L39: a never-terminating manual trigger loop and a
      `while true do end` Lua body both terminate within the budget with a
      surfaced error; cancel aborts a running manual trigger.
- [x] L40/L41: alternating distinct Lua trigger bodies reuses warm engines
      (boot-count probe); the editDisplay id set stays bounded across runs.
- [x] v4-L24 through v4-L29: translator output and regex work are memoized under stable
      invalidation keys; LLM translation cache growth/quota errors are
      bounded and surfaced once; deeplX fallback fanout is measured or
      guarded; `combineTranslation` avoids per-line network/script fanout.
      v4-L30 is recorded as Phase 5-owned, not Phase 8-owned.
- [x] M7/L43: repeated plugin toggles add zero net window listeners and zero
      duplicate provider entries (count probes), including V3 guest document
      listeners and `SafeMutationObserver`s from v4-L37.
- [x] L44-L48: logs gated; tool discovery skipped on the server route;
      concurrent first-init constructs one client; oversized SSE/PDF inputs
      bounded with clean failures; v4-L35 filesystem base64 and content
      search reads use chunked/capped paths with clean errors.
- [x] L49: attached `.txt` content reliably present in the prompt block
      (deterministic test, real async `addText`).
- [x] L50-L55/K4: zero payload logs on imggen sends; object-URL/AudioContext/
      pdf.js/synthesizer teardown verified per site; corrupt stableDiff
      reference image fails fast instead of hanging; v4-L31 imggen
      post-generation caption/poll work is abortable when included; v4-L36
      model/proxy image decode has byte/dimension caps before downscaling.
- [x] v4 inventory notes list every translator/MCP/media/plugin cache,
      listener, timer, blob URL, audio context, and debug log added to this
      phase as fixed, no-actioned with reason, or measured/deferred. v4-L38
      stays out unless a storage-persistence owner is explicitly added.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/mcp/mcplib.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/ts/translator/translator.html.test.ts \
  src/ts/process/__tests__/runStage4.test.ts \
  src/ts/process/stableDiff.test.ts \
  src/ts/process/tts.test.ts \
  src/ts/process/processzip.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
