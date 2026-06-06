# Phase 8: Client Interpreters, Plugins & Media (Theme 8)

Status: pending.

Goal: the hygiene ring 3 — port the server's execution budgets to the client
interpreters, fix the plugin/MCP lifecycle leaks and caps, and clear the
media/files leak-and-log cluster the v2 phase-7 sweep did not reach.

Findings: M7, L38-L55, K4.
Riding informational items: I16/I17 (TTS + LLM-translator logs, same sweep
as L50) — land if free.

## Planned Slices

Author under `slices/phase-8-client-interpreters-plugins-media/` when
starting. Suggested grouping (mirrors the v2 phase-7 slice shape):

- client-interpreter-budgets (L38, L39, L40, L41) — port
  `TriggerExecutionBudget` caps + abort to the client `runTrigger` (the live
  unbounded entry is `manual` mode: `/trigger` command and in-message
  trigger buttons); install the wasmoon instruction-count hook + wall-clock
  deadline on client Lua engines; key the engine cache on
  `(mode, codeHash)`; delete the editDisplay access key in a `finally`.
- tokenizer-and-cache-caps (L42) — LRU-bound `googleCloudTokenizedCache`
  (or fold into `encodeCache`).
- plugin-lifecycle (M7, L43, L44) — store `run()`'s cleanup closure on the
  SandboxHost instance and invoke it from `terminate()`; reset/dedupe the
  custom-provider stores on plugin reload; gate or remove the RPC console
  logs (never log transferables).
- mcp-lifecycle-and-caps (L45, L46, L47, L48) — compute tools lazily only
  in the browser-local adapters; in-flight construction promise per MCP
  key; size-cap the persistent `connectSSE` buffer; page/byte caps +
  AbortSignal + honored `limit` in the filesystem PDF read.
- file-attach-await (L49) — `await hypa.addText(...)` at the three builders
  (one-token fixes; update the test that mocks `addText` synchronously).
- media-leaks-and-logs (L50, L51, L52, L53, L54, L55, K4 + riding I16/I17)
  — remove the image-gen payload logs; revoke object URLs in `finally` at
  the image-processing sites (incl. the `scriptings.ts` siblings); shared/
  closed AudioContext for `runVITS` + decode error callback; dispose the
  VITS synthesizer on model switch; `pdf.destroy()` in `finally`; close the
  whisper-mode contexts and revoke the probe URL; `onerror` + timeout for
  the stableDiff reference-image load.
- phase-8-verification-refresh — gates, focused proofs, full validation,
  latest-verification update.

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

## Planned Shape

- Client budget ports must thread abort from the live entrypoints (the
  manual `/trigger` command path), not the dead output-trigger arm — the
  audit's liveness corrections name the live callers.
- The Lua deadline must throw into the existing catch (the engine-level
  hook), not freeze; budget defaults mirror the server constants.
- Plugin/MCP fixes are lifecycle-correctness: every add gets a paired
  remove; every check-then-await-then-assign gets an in-flight promise.
- L49 is silent-data-loss repair: the `<File>` block must contain the
  attached file's content deterministically; fix the synchronous-mock test
  that hides the race.
- Media fixes follow the existing in-repo patterns (shared context, revoke
  in finally, dispose-before-replace); K4 copies the landed v2-L49 guard.

## Exit Criteria

- [ ] L38/L39: a never-terminating manual trigger loop and a
      `while true do end` Lua body both terminate within the budget with a
      surfaced error; cancel aborts a running manual trigger.
- [ ] L40/L41: alternating distinct Lua trigger bodies reuses warm engines
      (boot-count probe); the editDisplay id set stays bounded across runs.
- [ ] M7/L43: repeated plugin toggles add zero net window listeners and zero
      duplicate provider entries (count probes).
- [ ] L44-L48: logs gated; tool discovery skipped on the server route;
      concurrent first-init constructs one client; oversized SSE/PDF inputs
      bounded with clean failures.
- [ ] L49: attached `.txt` content reliably present in the prompt block
      (deterministic test, real async `addText`).
- [ ] L50-L55/K4: zero payload logs on imggen sends; object-URL/AudioContext/
      pdf.js/synthesizer teardown verified per site; corrupt stableDiff
      reference image fails fast instead of hanging.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/mcp/mcplib.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/process/tts.test.ts \
  src/ts/process/processzip.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
