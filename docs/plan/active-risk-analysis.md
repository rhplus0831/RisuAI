# Active Risk Analysis

Date: 2026-06-06

This file maps every confirmed v3 audit finding to a phase, target fix, and
status. Evidence lives in
[`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md).
Proof runs live in [`latest-verification.md`](latest-verification.md). The
closed v1 and v2 plans are archived at
[`../archive/audit-stability-and-performance/`](../archive/audit-stability-and-performance/)
and
[`../archive/audit-stability-and-performance-v2/`](../archive/audit-stability-and-performance-v2/);
prior-audit finding IDs are referenced as `v1-*` / `v2-*`.

## Summary

- Confirmed findings: 89 total: 1 high, 9 medium, 56 low, 23 informational.
- Scheduled: H1, M1-M9, L1-L56, and the known-overlap residuals K1-K4. All
  scheduled rows are `PENDING`.
- Gated items: unchanged from v2 — `v2-L12`, plus the v1 carry-overs (v1-L4,
  v1-L7, v1-L26, v1-U2) and the `../archive/leftover.md` evidence gates. The
  v3 audit re-confirmed and respected all of them.
- No-action items: I1-I23 (inventory; several may ride phases for free — see
  the Informational table).
- Dismissed candidates: R1-R5 (v3-scoped), listed below so they are not
  rediscovered. The v1/v2 dismissed sets remain closed in their archives.

Theme routing (themes are defined in the audit's Cross-Cutting Themes):

- Theme 1 (send-path O(transcript|corpus)) -> Phase 1 (M4, M5, with H1),
  plus M1 in Phase 2 and the server-side amplifiers in Phase 7.
- Theme 2 (command-surface scoped-read ring 3) -> Phase 2.
- Theme 3 (cancel/terminal-state + deadlines) -> Phase 1 (H1) + Phase 4.
- Theme 4 (optimistic-write state machine) -> Phase 5.
- Theme 5 (projection-guard feature breakage) -> Phase 5.
- Theme 6 (reactive amplification) -> Phase 6.
- Theme 7 (memory budget + per-send memory cost) -> Phase 3.
- Theme 8 (opt-in subsystem hygiene ring 3) -> Phase 8, with the server
  assembly/trigger residuals in Phase 7.
- Theme 9 (transport/build defaults) -> Phase 4.
- Phase 0 supplies foundations. Phase 9 supplies the standing gate.

Principle: narrow hot-path work or add a preventive bound. Preserve protocol,
rollback scope, output bytes, and broad paths for true full-corpus consumers.
Two scheduled fixes intentionally change observable behavior and must be
explicit and tested: M2 (the memory token budget starts being enforced) and
H1 (a cancelled generation stops emitting a success terminal frame).

## Finding -> Phase Map

Keep these tables machine-readable. The Phase 9 gate parses `| ID | ... |`
rows and the `PENDING`/`DONE` markers (Phase 0 authors the v3 gate with ID
classes `H/M/L/I/K` and statuses `PENDING`/`DONE`, mirroring the v2 gate).

### High

| ID  | Phase                                       | Target fix                                                                  | Status  |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| H1  | [1](phases/phase-1-high-and-send-path.md)   | Guard the transport's post-loop fallthrough on `signal?.aborted` (+ in-loop re-check); durable-cancel regression test. | DONE |

### Medium

| ID  | Phase                                                      | Target fix                                                                 | Status  |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| M1  | [2](phases/phase-2-command-surface-scoping.md)              | Wire `chatScopedRead: hasVarWrite ? undefined : { chatId }` into `persistAssemblyMutations` (K1 shape; assert event parentId = character id). | DONE |
| M2  | [3](phases/phase-3-memory-subsystem.md)                     | Supply tiktoken-fallback `getSummaryTokenCost` in the `selectPromptMemory` call (repairs existing `tokens:0` rows); optionally also measure at persist. | DONE |
| M3  | [2](phases/phase-2-command-surface-scoping.md)              | Settings-scoped read for the settings/prompt-settings command routes (v2-L3 shape; broad fallback on the pre-extraction edge). | DONE |
| M4  | [1](phases/phase-1-high-and-send-path.md)                   | Plain-append fast-path via the single-message append command + id-keyed rollback; keep replace for trigger-rewritten transcripts. | DONE |
| M5  | [1](phases/phase-1-high-and-send-path.md)                   | Field-scoped send rollback (`lastInteraction`; messages only on the first-send backfill branch), `restoreCharacterSelection` shape. | DONE |
| M6  | [6](phases/phase-6-reactive-amplification-and-render.md)    | `$derived` + keyed each for the MobileCharacters sorted list (v2-L42/L43 helper shape, unit-testable pure function). | DONE |
| M7  | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Store `run()`'s cleanup closure on the SandboxHost instance; invoke from `terminate()`. | PENDING |
| M8  | [5](phases/phase-5-client-write-path-correctness.md)        | `flushAllPendingBridgePatches()` aggregator on `pagehide`/`visibilitychange(hidden)` + watcher teardown; `keepalive` dispatch. | DONE |
| M9  | [4](phases/phase-4-server-lifecycle-and-transport.md)       | `process.once('SIGTERM'\|'SIGINT')` -> `await app.close()` with a force-exit backstop. | DONE |

### Low

| ID  | Phase                                                      | Target fix                                                                 | Status  |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| L1  | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Read assembly asset bytes off the event loop (async pre-resolve or async resolver contract). | DONE |
| L2  | [4](phases/phase-4-server-lifecycle-and-transport.md)       | Thread `RequestAbort.refresh` into `pipeStream` on activity frames (mirror `streamAssembly`). | DONE |
| L3  | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Compute reformat flags first; return `rows` unchanged when no branch applies (or clone lazily per branch). | DONE |
| L4  | [4](phases/phase-4-server-lifecycle-and-transport.md)       | `AbortSignal.timeout` on the fire-and-forget Horde DELETE.                  | DONE |
| L5  | [4](phases/phase-4-server-lifecycle-and-transport.md)       | Create proxy stream jobs with `slidingDeadline: true` (activity detection already exists in `pushRaw`). | DONE |
| L6  | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Build the char+module asset table once per assembly; share with `buildAssetLookup`. | DONE |
| L7  | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Iterate the depth slice and recursive entries without the per-call concat.  | DONE |
| L8  | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Per-phase narrowing of the `runTrigger` chat clone (skip/limit for non-message-mutating trigger sets; do NOT share one clone across phases). | PENDING |
| L9  | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Bound user-regex execution (haystack/pattern caps or complexity screen); document non-interruptibility at minimum. | PENDING |
| L10 | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Bump the history-callback memo generation from every chat-var-dirty fold (all three un-bumped sites). | PENDING |
| L11 | [2](phases/phase-2-command-surface-scoping.md)              | Collection-scoped mutation reads for the preset/persona/loadout/plugin/global-lorebook/translator-preset routes (reuse `COLLECTION_TABLE_MAP` machinery). | DONE |
| L12 | [2](phases/phase-2-command-surface-scoping.md)              | Drop the discarded corpus-wide validate-only normalization; validate the target row only. | DONE |
| L13 | [2](phases/phase-2-command-surface-scoping.md)              | `skipDatabaseLoad: true` on the single-key plugin-storage PUT/DELETE.       | DONE |
| L14 | [2](phases/phase-2-command-surface-scoping.md)              | Single-row read via `getCharacterRowsByIds` for the single lorebook hydration (mirror the bulk sibling). | DONE |
| L15 | [3](phases/phase-3-memory-subsystem.md)                     | Per-row token memo (WeakMap/content-hash) so the immutable summarized prefix tokenizes once. | DONE |
| L16 | [3](phases/phase-3-memory-subsystem.md)                     | Arm a default deadline on the already-threaded memory-fetch AbortController (clear in finally). | DONE |
| L17 | [4](phases/phase-4-server-lifecycle-and-transport.md)       | Per-import AbortSignal (client-close + wall-clock) threaded into all realm egress fetches, both route branches. | DONE |
| L18 | [4](phases/phase-4-server-lifecycle-and-transport.md)       | Per-asset + cumulative byte caps for JSON-card staging (charx shape); bound the dynamic `res.json()` body. | DONE |
| L19 | [4](phases/phase-4-server-lifecycle-and-transport.md)       | Register response compression (`@fastify/compress` or onSend gzip) with a sane threshold, default ON. | DONE |
| L20 | [4](phases/phase-4-server-lifecycle-and-transport.md)       | `maxAge: '1y', immutable: true` for the hashed SPA chunks (index.html stays uncached). | DONE |
| L21 | [5](phases/phase-5-client-write-path-correctness.md)        | Add a rollback parameter to `runPresetCommand`; snapshot `botPresets`/`botPresetsId` + the `setPreset` scalar settings. | DONE |
| L22 | [6](phases/phase-6-reactive-amplification-and-render.md)    | Gate the character-draft mirror recomputation (character switch / apply epoch); split the read/seed effect. | DONE |
| L23 | [5](phases/phase-5-client-write-path-correctness.md)        | `suppressRollbackDispatch` around both the optimistic write and the rollback in `applyServerBackedSettingsPatch`. | DONE |
| L24 | [5](phases/phase-5-client-write-path-correctness.md)        | Suppress the global-lorebook direct dispatchers' rollbacks (route through `rollbackLorebookReplacement`). | DONE |
| L25 | [5](phases/phase-5-client-write-path-correctness.md)        | Keep the FIRST baseline across coalesced same-item prompt-template edits.   | DONE |
| L26 | [5](phases/phase-5-client-write-path-correctness.md)        | Route the chat-row metadata rollback through the suppressing wrapper.       | DONE |
| L27 | [5](phases/phase-5-client-write-path-correctness.md)        | Promote the pending entry snapshot to a collection snapshot when a second entry edit lands in the same debounce window. | DONE |
| L28 | [6](phases/phase-6-reactive-amplification-and-render.md)    | Reference-keyed lazy `localLore` snapshots in the character-scope watcher (keep full rollback coverage). | DONE |
| L29 | [6](phases/phase-6-reactive-amplification-and-render.md)    | Cheap short-circuit before the chat-metadata watcher's per-chat scalar Map rebuild. | DONE |
| L30 | [6](phases/phase-6-reactive-amplification-and-render.md)    | Cache the corpus-derived parse-memo key signature by its cheap invalidation tokens; build the detection key once per message. | DONE |
| L31 | [6](phases/phase-6-reactive-amplification-and-render.md)    | Memoize the parsed customHTML GUI template per template version, shared across messages. | DONE |
| L32 | [6](phases/phase-6-reactive-amplification-and-render.md)    | Cap `bestMatchCache` and reset it in `resetScriptCache()`.                  | DONE |
| L33 | [6](phases/phase-6-reactive-amplification-and-render.md)    | Stop/null `bgmElement` on chat/character switch; clear stale observed bgm nodes. | DONE |
| L34 | [5](phases/phase-5-client-write-path-correctness.md)        | Wrap the IGP append in the trusted write + persist via a scoped chat command (fix the I11 `[object Object]` coercion in the same change). | DONE |
| L35 | [5](phases/phase-5-client-write-path-correctness.md)        | Wrap + dispatch a scoped command for the inlay error bubble; add a guard-enabled test. | DONE |
| L36 | [5](phases/phase-5-client-write-path-correctness.md)        | Route `sendPofile` transcript mutations through the trusted write + scoped messages command; absorb picker cancel/error and `.po` processing failures at the `postChatFile` boundary. | DONE |
| L37 | [5](phases/phase-5-client-write-path-correctness.md)        | Null-safe global error handler: check `event.target` (not `event.error.target`), skip alerting when no usable error exists. | DONE |
| L38 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Port the server `TriggerExecutionBudget` caps + abort to the client `runTrigger` (manual entrypoints). | PENDING |
| L39 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Install the instruction-count hook + wall-clock deadline on client Lua engines (server `luaRuntime` shape). | PENDING |
| L40 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Key the client Lua engine cache on `(mode, codeHash)` (or a small per-mode LRU). | PENDING |
| L41 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Delete the editDisplay access key in the cleanup tail (run cleanup in a `finally`). | PENDING |
| L42 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | LRU-bound `googleCloudTokenizedCache` (or fold into `encodeCache`).          | PENDING |
| L43 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Reset/dedupe the custom-provider stores on plugin reload (mirror the existing reset block; or unload-callback removal). | PENDING |
| L44 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Gate or remove the SandboxHost RPC console logs (never log transferables).  | PENDING |
| L45 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Compute MCP tools lazily, only in the browser-local adapters that consume them. | PENDING |
| L46 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | In-flight construction promise per MCP key (the `mcpToolClientIndexBuild` dedup shape). | PENDING |
| L47 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Size-cap the persistent `connectSSE` buffer (abort + destroy past a few MB without a delimiter). | PENDING |
| L48 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Page/byte caps + AbortSignal + honor the `limit` argument in the MCP PDF read. | PENDING |
| L49 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | `await hypa.addText(...)` at the three file-attach builders.                 | PENDING |
| L50 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Remove the image-generation payload logs (incl. the comfy poll-loop log).    | PENDING |
| L51 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Revoke object URLs in `finally` at the image-processing sites (incl. the `scriptings.ts` siblings). | PENDING |
| L52 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Shared/closed AudioContext for `runVITS` (mirror `getNetworkAudioContext`); add the missing decode error callback. | PENDING |
| L53 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Dispose the old VITS synthesizer before replacing (mirror the extractor).    | PENDING |
| L54 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | `await pdf.destroy()` in a `finally` after PDF conversion.                   | PENDING |
| L55 | [8](phases/phase-8-client-interpreters-plugins-media.md)    | Close the whisper-mode AudioContexts and revoke the probe-video URL.         | PENDING |
| L56 | [4](phases/phase-4-server-lifecycle-and-transport.md)       | Keep the proxy-stream abort listener attached for the whole stream; issue the job DELETE from `closeAndEnd` when no terminal frame arrived. | DONE |

### Known-Overlap Residuals (scheduled)

Verified-live residuals or corrected dispositions of prior-audit items; the
prior IDs stay closed in their archives, these rows own the remaining gap.

| ID  | Phase                                                      | Target fix                                                                 | Status  |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| K1  | [3](phases/phase-3-memory-subsystem.md)                     | Skip/lazy the embedding `vector_blob` decode when no valid query vectors exist (v2-R5 re-open: the dismissal covered the math, not the decode). | DONE |
| K2  | [2](phases/phase-2-command-surface-scoping.md)              | Drop the redundant in-handler auth verify on the proxy/hub routes (v2-L16 propagation). | DONE |
| K3  | [7](phases/phase-7-assembly-and-trigger-hot-paths.md)       | Return the provably-immutable `initialMessages` restoration payload by reference (v2-M1 ring). | DONE |
| K4  | [8](phases/phase-8-client-interpreters-plugins-media.md)    | `onerror` + timeout for the stableDiff reference-image load (v2-L49 propagation). | PENDING |

### Informational

All routed `no action` (inventory). Evidence in the audit's
[Informational Findings](audit-stability-and-performance-v3.md#informational-findings)
section. Items marked "may ride" can land for free inside the named phase if
the touching slice is already there; none is required.

| ID  | Routing   | Note                                                              |
| --- | --------- | ----------------------------------------------------------------- |
| I1  | no action | Active-writer guard manifest scan per request (method-prefiltered, cached regexes). |
| I2  | no action | Bulk projection unbounded (deduped) ids + O(N·M) apply loop (export readers only). |
| I3  | no action | Proxy copies the request body before forwarding (bounded by bodyLimit). |
| I4  | no action | Finalization retry lacks attempt cap/backoff (realistic errors self-heal). |
| I5  | no action | JS trigger budget recreated per phase; may ride Phase 7 (shared per-send budget) if free. |
| I6  | no action | Summarize handler O(total chats) existence scan; may ride Phase 3 (hoist per batch / indexed probe) if free. |
| I7  | no action | Server prompt-assembly classifier runs twice per send; may ride Phase 1 if free. |
| I8  | no action | `assetByteReadCounts` diagnostics Map populated with metrics off (no live consumer). |
| I9  | no action | `addFetchLog` (streaming) never trims while the JSON path caps at 20. |
| I10 | no action | `addFetchLog` positional index-0 aliasing corrupts the debug fetch view. |
| I11 | no action | `evaluateIgp` appends `'[object Object]'` — fixed as part of L34, not separately. |
| I12 | no action | ModuleChatMenu per-keystroke sort (v2-L43 sibling); may ride Phase 6 if free. |
| I13 | no action | Code-block download object URL never revoked. |
| I14 | no action | BotSettings preset-icon object URL never revoked. |
| I15 | no action | `hypaVector` IndexedDB embedding cache grows without eviction (intentional disk cache). |
| I16 | no action | GPT-SoVITS/FishSpeech TTS log full bodies; may ride Phase 8's L50 log sweep if free. |
| I17 | no action | LLM translator logs `translatorNote` per cache-missed call; may ride Phase 8's L50 sweep if free. |
| I18 | no action | `templateCheck` re-scans per guarded write while Prompt Settings is open (v2-M13 deferred); may ride Phase 6 if free. |
| I19 | no action | `DBState.db` proxy re-mint per guarded write is the deliberate design; fix consumers (Phase 6), not the guard. |
| I20 | no action | `@@inject` display action silent no-op under the guard; rides Phase 5's guard-repair batch (same wrap pattern as L34-L36). |
| I21 | no action | `alertError` throws on undefined rejection reasons; rides L37's handler hardening. |
| I22 | no action | Production image ships 74 MB of sourcemaps (build hygiene; optional). |
| I23 | no action | No `manualChunks`; ~3.5 MB eager app graph incl. all-locale lang chunk (optional split). |

## Gated / Owner-Decision

Unchanged from the v2 closeout; the v3 audit re-confirmed and respected these.
Keep them gated on `RISU_PROTOCOL_METRICS` evidence or owner approval.

- `v2-L12` — fresh-boot Lua runs serialize behind active runs (documented
  wasmoon shared-wasm boot constraint).
- v1 carry-overs (owned by the
  [archived v1 risk analysis](../archive/audit-stability-and-performance/active-risk-analysis.md)):
  v1-L4 (var-write full-table persist breadth — note M1 is the missing scoped
  READ on the no-var-write branch and is explicitly NOT under this gate),
  v1-L7 (Tier-5 create/delete floor — M3/L11 are reads on routes outside the
  four-route floor and NOT under this gate), v1-L26 (streaming `.risu`
  export), v1-U2 (full-bootstrap fallback + serial replay).
- `../archive/leftover.md` evidence gates: prompt-assembly hydrated load +
  `finalizeRequestBudget` re-tokenize, bootstrap full corpus load, per-asset
  byte fanout, memory-worker within-batch blocking, serverChat token string
  re-accumulation.
- Unscheduled v3 known-overlap notes (fold-if-touched, no own rows):
  `buildSearchableCorpus` dual normalization (v2-L5 adjacent, info) and the
  `request.ts` Trigger-time log (v1-L38 closeout note, opportunistic).

## Source Anchors

- Send path: `src/lib/ChatScreens/DefaultChatScreen.svelte` (send handler),
  `src/ts/chatCommands.ts` (`currentChatScopedSnapshot`,
  `dispatchReplaceMessagesWith`, `appendCurrentChatUserMessageForSend`),
  `src/ts/process/sendChatContext.ts`, `src/ts/characterCommands.ts`,
  `server/fastify/src/prompt/providerTransport.ts` (`emitProviderChunks`).
- Command surface: `server/fastify/src/commands/mutations.ts`
  (`applyTargetedCommandMutation`, `chatScopedRead`, `skipDatabaseLoad`),
  `routes/commands.ts` (settings/collection/plugin-storage/lorebook/script
  routes), `routes/generationChat.ts` (`persistAssemblyMutations`),
  `repository.ts` (`loadPersisted`, `COLLECTION_TABLE_MAP`,
  `loadCharacterLorebookHydration`), `commands/lorebooks.ts`,
  `commands/scriptDefinitions.ts`, `routes/proxy.ts`, `routes/hub.ts`.
- Memory: `server/fastify/src/memorySummaryAdapter.ts`,
  `memorySummarizeJobHandler.ts`, `memoryBudgetAllocator.ts`,
  `memoryPlanner.ts`, `memoryEmbedJobHandler.ts`, `memoryRepository.ts`
  (`decodeEmbeddingVector`), `prompt/assemble.ts` (`selectPromptMemory`
  call), `prompt/memory.ts`, `memoryLegacyImport.ts`.
- Server lifecycle/transport: `server/fastify/src/index.ts`, `app.ts`
  (onClose, static registration, no compress), `routes/generation.ts`
  (`pipeStream`), `routes/streamJobs.ts` + `streamJobs.ts`
  (`slidingDeadline`), `routes/realmImport.ts`, `generation/horde.ts`,
  `requestAbort.ts`; client `src/ts/globalApi.svelte.ts`
  (`fetchViaProxyJobWs`).
- Client write-path correctness: `src/ts/server/settingsBridge.svelte.ts`,
  `chatBridge.svelte.ts`, `lorebookBridge.svelte.ts`,
  `characterBridge.svelte.ts`, `src/lib/Setting/Pages/PromptSettings.svelte`
  + `src/lib/UI/PromptDataItem.svelte`, `src/ts/storage/database.svelte.ts`
  (`runPresetCommand`), `src/ts/process/postGeneration/igp.ts`,
  `src/ts/process/sendChatErrors.ts`, `src/ts/process/files/multisend.ts`
  (`sendPofile`), `src/ts/bootstrap.ts` (error handlers),
  `src/ts/server/projectionWriteGuard.svelte.ts`, `src/ts/server/commands.ts`.
- Reactive/render: `src/ts/server/lorebookBridge.svelte.ts`
  (`collectCharacterLorebookSnapshots`), `chatBridge.svelte.ts` (watcher),
  `characterBridge.svelte.ts` (draft mirror),
  `src/lib/Mobile/MobileCharacters.svelte`,
  `src/lib/ChatScreens/ChatBodyParseMemo.ts`,
  `src/lib/ChatScreens/Chat.svelte` (customHTML), `src/ts/process/scripts.ts`
  (`bestMatchCache`), `src/ts/observer.svelte.ts` (`bgmElement`).
- Assembly/trigger hot paths: `server/fastify/src/routes/generationChat.ts`
  (`readStoredAsset`), `prompt/chatDispatch.ts` (`reformatMessages`),
  `prompt/history.ts` (`processAssetPrompts`), `prompt/lorebook.ts`
  (`searchMatch`), `prompt/triggers.ts` + `triggerDataEffects.ts`,
  `prompt/assemble.ts` (`buildRestorationPayload`, history-memo bump sites),
  `src/ts/cbs.ts` (memo keys).
- Client interpreters/plugins/media: `src/ts/process/triggers.ts`,
  `scriptings.ts`, `tokenizer.ts`, `src/ts/plugins/apiV3/factory.ts` +
  `v3.svelte.ts`, `plugins.svelte.ts`, `src/ts/process/mcp/` (`mcp.ts`,
  `mcplib.ts`, `filesystemclient.ts`), `src/ts/process/dynamicutils/pdf.ts`,
  `files/multisend.ts`, `files/inlays.ts`, `processzip.ts`,
  `stableDiff.ts`, `transformers.ts`, `tts.ts`,
  `src/lib/Playground/PlaygroundSubtitle.svelte`.
- Reference templates: `chatScopedRead`/`loadPersistedForChatMutation`,
  `loadServerIntentCompletionSettings` (v2-L3), the append writer kit +
  `appendCurrentChatUserMessageForSend`, `CharacterSelectionSnapshot`/
  `restoreCharacterSelection`, `rollbackServerBackedLorebooks` (suppression
  flag), `formatGridCatalogCharacterLists`/`sortModuleSettingsRows`
  ($derived helpers), `TriggerExecutionBudget` + `LuaExecBudget`,
  `getNetworkAudioContext`, `requestAbort.ts`/`createHubAbort` deadlines,
  `boundedInflate.ts`, the `processScriptCache` LRU cap shape.

## Dismissed Candidates

These were adversarially verified as non-issues against current code (full
refutations in the audit's
[Investigated And Dismissed](audit-stability-and-performance-v3.md#investigated-and-dismissed)
section). v3-scoped; the v1/v2 R-sets stay closed in their archives.

- R1 - `similaritySearchVectorWithScore` invalid comparator mis-orders
  results: empirically byte-identical to the correct comparator on V8/Node 24
  across exhaustive trials; portability nit at most.
- R2 - `pyworker` listener/promise leak: dead arm — no live caller ever
  passes `type: 'py'`.
- R3 - ChatBody parse memo serves stale `{{getvar}}` output: the variable is
  resolved before the memo and rides the key via `data`; the claimed pre-memo
  reactivity never existed (async deriveds track only synchronous reads).
- R4 - Buffered standalone completion handlers send no response on
  deadline-abort: unreachable — the sole live client always routes to the
  server-intent handler, which always replies.
- R5 - Chat-FOLDER-row rollback un-suppressed: the folder-row dispatch path
  has no live entry point (all reactive folder writes are dead-armed behind
  `!canUseServerCommands()`); the live chat-ROW case is scheduled as L26.

## Non-Goals

- Do not change the projection/bootstrap/revision/event wire model, `.risu`
  bytes, rendered output, or persisted state — with two scheduled, documented
  exceptions: M2 (memory budget becomes enforced: assembled prompts for
  memory-enabled chats change intentionally) and H1 (cancel emits an aborted
  terminal instead of a spurious success `done`). M4 switches the plain-send
  dispatch from the replace command to the existing append command — both are
  existing protocol routes; event consumers must be re-verified.
- Do not remove broad SQLite loaders or full-collection snapshots. Keep them
  for true full-corpus consumers.
- Do not schedule `v2-L12` or the v1 carry-over gates without evidence or
  owner approval.
- Do not re-open dismissed candidates (v3 R1-R5, v2 R1-R13, or v1's R-set)
  without new evidence.
