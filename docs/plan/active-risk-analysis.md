# Active Risk Analysis

Date: 2026-06-06

This file maps every confirmed v2 audit finding to a phase, target fix, and
status. Evidence lives in
[`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md).
Proof runs live in [`latest-verification.md`](latest-verification.md). The v1
plan (all phases closed) is archived at
[`../archive/audit-stability-and-performance/`](../archive/audit-stability-and-performance/);
v1 finding IDs are referenced as `v1-*`.

## Summary

- Confirmed findings: 102 total: 3 high, 22 medium, 59 low, 18 informational.
- Scheduled: H1-H3, M1-M22, L1-L11 (except L12), L13-L59, and the
  known-overlap residuals K1-K4. H1-H3, Phase 3 M1-M4 and L4-L11, Phase
  2 M5, M6, L3, L13, L14, L16, K1, and K2, plus Phase 8 L1, L2, L15, and
  L17-L22 are `DONE`; the rest are `PENDING`.
- Gated items: L12, plus the v1 carry-overs (v1-L4, v1-L7, v1-L26, v1-U2) and
  the `leftover.md` evidence gates.
- No-action items: I1-I18 (inventory; I3 and I16 may ride Phases 8/3 if free).
- Dismissed candidates: R1-R13, listed below so they are not rediscovered.

Root routing:

- Root 1 -> Phase 2: hydrated whole-corpus mutation/read paths, ring 2.
- Root 2 -> Phase 3: CBS/`risuChatParser` per-send interpreter costs.
- Root 3 -> Phase 4: client whole-corpus clones, ring 2.
- Root 4 -> Phases 1+5: GUI-reload remount amplifier and render costs.
- Root 5 -> Phase 7: opt-in subsystems (translate/TTS/MCP/files).
- Root 6 -> Phase 6: bridge echo-guard asymmetry and lifecycle hygiene.
- Phase 0 supplies foundations. Phase 9 supplies the standing gate.

Principle: narrow hot-path work or add a preventive bound. Preserve protocol,
rollback scope, output bytes, and broad paths for true full-corpus consumers.

## Finding -> Phase Map

Keep these tables machine-readable. The Phase 9 gate parses `| ID | ... |`
rows and the `DONE` marker (Phase 0 authors the v2 gate with ID classes
`H/M/L/I/K` and statuses `PENDING`/`DONE`).

### High

| ID  | Phase                                          | Target fix                                                       | Status  |
| --- | ---------------------------------------------- | ---------------------------------------------------------------- | ------- |
| H1  | [1](phases/phase-1-high-severity-hot-paths.md) | Signal + wall-clock budget + iteration/recursion caps in `runTrigger`. | DONE    |
| H2  | [1](phases/phase-1-high-severity-hot-paths.md) | Chat-create via the targeted writer kit (fork-route shape).      | DONE    |
| H3  | [1](phases/phase-1-high-severity-hot-paths.md) | Decouple `ReloadGUIPointer` from whole-screen remount + cache wipe. | DONE    |

### Medium

| ID  | Phase                                            | Target fix                                                      | Status  |
| --- | ------------------------------------------------ | ---------------------------------------------------------------- | ------- |
| M1  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Dirty-flag `captureMessageReplacement`; compare before clone.    | DONE    |
| M2  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Marker fixed-point guard in `formatHistoryMessage`.              | DONE    |
| M3  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Render stable template cards once; preflight tokenizes cached rows. | DONE    |
| M4  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Memoize charhistory/userhistory/lorebook callbacks per assembly. | DONE    |
| M5  | [2](phases/phase-2-server-corpus-ring-2.md)      | Single-row scoped read + repair for character/chat PATCH.        | DONE    |
| M6  | [2](phases/phase-2-server-corpus-ring-2.md)      | Field-scoped projection loaders that skip the characters parse.  | DONE    |
| M7  | [4](phases/phase-4-client-clone-ring-2.md)       | Assign `replace_all` messages without `structuredClone`.         | PENDING |
| M8  | [4](phases/phase-4-client-clone-ring-2.md)       | `getItem` reads one key, not a whole-DB snapshot.                | PENDING |
| M9  | [4](phases/phase-4-client-clone-ring-2.md)       | Allowed-keys diff for `changedChatMetadata` (v1-M13 shape).      | PENDING |
| M10 | [4](phases/phase-4-client-clone-ring-2.md)       | Module-only / single-row module snapshots.                       | PENDING |
| M11 | [6](phases/phase-6-bridges-lifecycle-network.md) | Apply-epoch gate for the lorebook watcher (+ epoch-bumping apply). | PENDING |
| M12 | [6](phases/phase-6-bridges-lifecycle-network.md) | Apply-epoch gate for the character-profile watcher.              | PENDING |
| M13 | [5](phases/phase-5-client-render-and-ui.md)      | Debounce + per-item memo for prompt-template tokenize.           | PENDING |
| M14 | [6](phases/phase-6-bridges-lifecycle-network.md) | Idempotent `nodeObserve` (or wire the dead MutationObserver).    | PENDING |
| M15 | [7](phases/phase-7-opt-in-subsystems.md)         | Bounded Map (LRU) translate cache.                               | PENDING |
| M16 | [7](phases/phase-7-opt-in-subsystems.md)         | Remove html log; `DoingChat` gate for non-exp translators.       | PENDING |
| M17 | [5](phases/phase-5-client-render-and-ui.md)      | Module-level content-keyed translate-detection memo.             | PENDING |
| M18 | [7](phases/phase-7-opt-in-subsystems.md)         | Reuse/close `AudioContext` per playback.                         | PENDING |
| M19 | [7](phases/phase-7-opt-in-subsystems.md)         | Reset bergamot chain on rejection; reinit on wasm error.         | PENDING |
| M20 | [7](phases/phase-7-opt-in-subsystems.md)         | Bounded deadlines for MCP request/handshake/SSE waits.           | PENDING |
| M21 | [7](phases/phase-7-opt-in-subsystems.md)         | Parenthesized guard + mid-stream byte cap in CharX import.       | PENDING |
| M22 | [7](phases/phase-7-opt-in-subsystems.md)         | Remove the `.po` 100-line test cap.                              | PENDING |

### Low

| ID  | Phase                                            | Target fix                                                       | Status  |
| --- | ------------------------------------------------ | ----------------------------------------------------------------- | ------- |
| L1  | [8](phases/phase-8-server-bounds.md)             | Sliding durable deadline paired with the non-durable generation abort window. | DONE    |
| L2  | [8](phases/phase-8-server-bounds.md)             | Delete/TTL terminal finalization-retry rows.                      | DONE    |
| L3  | [2](phases/phase-2-server-corpus-ring-2.md)      | Settings-only loader for server-intent completion.                | DONE    |
| L4  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Persist lorebook sticky-activation chat-var writes.               | DONE    |
| L5  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Hoist per-message normalization out of `searchMatch`.             | DONE    |
| L6  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Memoize trigger/effect regexes; hoist transcript joins.           | DONE    |
| L7  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Trigger-presence check before the `runTrigger` clones.            | DONE    |
| L8  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Hoist `SEND_NAME_WRAPPER` expansion once per assembly.            | DONE    |
| L9  | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Expand depth-prompt bodies once; preflight reuses.                | DONE    |
| L10 | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Cap `{{#each}}` expansion size.                                   | DONE    |
| L11 | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Cheap CBS tag-name normalization.                                 | DONE    |
| L12 | gated                                            | Lua pool/boot serialization is the documented wasmoon constraint. | -       |
| L13 | [2](phases/phase-2-server-corpus-ring-2.md)      | Targeted writes for Realm character append.                       | DONE    |
| L14 | [2](phases/phase-2-server-corpus-ring-2.md)      | Delta-aware transcript persist diff.                              | DONE    |
| L15 | [8](phases/phase-8-server-bounds.md)             | `PRAGMA synchronous = NORMAL`.                                    | DONE    |
| L16 | [2](phases/phase-2-server-corpus-ring-2.md)      | Single auth verification on the bulk routes.                      | DONE    |
| L17 | [8](phases/phase-8-server-bounds.md)             | Retention sweep for terminal memory jobs.                         | DONE    |
| L18 | [8](phases/phase-8-server-bounds.md)             | Fast-path reschedule after a productive worker tick.              | DONE    |
| L19 | [8](phases/phase-8-server-bounds.md)             | Scope the fail-cascade to contextual groups.                      | DONE    |
| L20 | [8](phases/phase-8-server-bounds.md)             | Share one summaries fetch between cleanup and selection.          | DONE    |
| L21 | [8](phases/phase-8-server-bounds.md)             | Per-chunk size ceiling before embed requests.                     | DONE    |
| L22 | [8](phases/phase-8-server-bounds.md)             | Size the contextual budget from provider limits; surface splits.  | DONE    |
| L23 | [8](phases/phase-8-server-bounds.md)             | Batch JSON-card asset persists (charx shape).                     | DONE    |
| L24 | [8](phases/phase-8-server-bounds.md)             | Compensating asset cleanup when the append fails.                 | DONE    |
| L25 | [8](phases/phase-8-server-bounds.md)             | Open-or-skip assets at stream time (`missingFiles` degrade).      | DONE    |
| L26 | [8](phases/phase-8-server-bounds.md)             | Temp-file + rename for legacy storage writes.                     | DONE    |
| L27 | [8](phases/phase-8-server-bounds.md)             | Abort/timeout (+ streaming) for hub forwards.                     | PENDING |
| L28 | [8](phases/phase-8-server-bounds.md)             | Drop the double clone in JSON import normalize.                   | PENDING |
| L29 | [8](phases/phase-8-server-bounds.md)             | Cap the charx download near the expanded limit.                   | PENDING |
| L30 | [8](phases/phase-8-server-bounds.md)             | In-flight promise dedupe for Vertex tokens.                       | PENDING |
| L31 | [8](phases/phase-8-server-bounds.md)             | Default proxy deadline when `risu-timeout-ms` is absent.          | PENDING |
| L32 | [4](phases/phase-4-client-clone-ring-2.md)       | Drop `setDatabase` from `/send`-family + `mutateCurrentChatMessages`. | PENDING |
| L33 | [4](phases/phase-4-client-clone-ring-2.md)       | Single-row snapshot for trash `removeChar`.                       | PENDING |
| L34 | [4](phases/phase-4-client-clone-ring-2.md)       | Minimal `supaMemory` patch on selection.                          | PENDING |
| L35 | [6](phases/phase-6-bridges-lifecycle-network.md) | Carry `hypaV3Data` independently of message length.               | PENDING |
| L36 | [6](phases/phase-6-bridges-lifecycle-network.md) | Bound the prereroll maps; clear on chat switch.                   | PENDING |
| L37 | [4](phases/phase-4-client-clone-ring-2.md)       | Same-language early-return in `changeLanguage`.                   | PENDING |
| L38 | [5](phases/phase-5-client-render-and-ui.md)      | Remove `{{#function}}`/`{{call::}}` logs.                         | PENDING |
| L39 | [5](phases/phase-5-client-render-and-ui.md)      | `includes()` fast path + indexOf scan in `parseThoughtsAndTools`. | PENDING |
| L40 | [5](phases/phase-5-client-render-and-ui.md)      | Module-level content-keyed `ParseMarkdown` memo (with H3).        | PENDING |
| L41 | [5](phases/phase-5-client-render-and-ui.md)      | One shared partial-edit mousemove handler.                        | PENDING |
| L42 | [5](phases/phase-5-client-render-and-ui.md)      | `$derived` + keyed each for GridCatalog.                          | PENDING |
| L43 | [5](phases/phase-5-client-render-and-ui.md)      | `$derived` + keyed each for ModuleSettings.                       | PENDING |
| L44 | [5](phases/phase-5-client-render-and-ui.md)      | Cheap signature compare for the sidebar list effect.              | PENDING |
| L45 | [6](phases/phase-6-bridges-lifecycle-network.md) | Capped exponential backoff + jitter for SSE reconnect.            | PENDING |
| L46 | [6](phases/phase-6-bridges-lifecycle-network.md) | Bound `sseIdDone` (windowed dedup).                               | PENDING |
| L47 | [6](phases/phase-6-bridges-lifecycle-network.md) | Remove the `fetchNative` body log.                                | PENDING |
| L48 | [7](phases/phase-7-opt-in-subsystems.md)         | Translate once; cap HF TTS retries.                               | PENDING |
| L49 | [7](phases/phase-7-opt-in-subsystems.md)         | `decode()`/`complete` guard + onerror for inlay images.           | PENDING |
| L50 | [7](phases/phase-7-opt-in-subsystems.md)         | LRU + revoke for `blobUrlCache`.                                  | PENDING |
| L51 | [7](phases/phase-7-opt-in-subsystems.md)         | Single-pass PNG import (or value-free count pass).                | PENDING |
| L52 | [7](phases/phase-7-opt-in-subsystems.md)         | Remove the file-send logs.                                        | PENDING |
| L53 | [7](phases/phase-7-opt-in-subsystems.md)         | Pass raw bytes to pdfjs.                                          | PENDING |
| L54 | [7](phases/phase-7-opt-in-subsystems.md)         | Timeout + tracked listeners for MCP SSE waits.                    | PENDING |
| L55 | [7](phases/phase-7-opt-in-subsystems.md)         | Cache internal MCP tool lists; name->client index.                | PENDING |
| L56 | [7](phases/phase-7-opt-in-subsystems.md)         | Persist the FS directory handle across recreate.                  | PENDING |
| L57 | [7](phases/phase-7-opt-in-subsystems.md)         | Wire the debug flag; gate MCP logs.                               | PENDING |
| L58 | [7](phases/phase-7-opt-in-subsystems.md)         | Epoch-guard `translateSuggest` writes.                            | PENDING |
| L59 | [7](phases/phase-7-opt-in-subsystems.md)         | Skip retrying translation network errors in `markParsing`.        | PENDING |

### Known-Overlap Residuals (scheduled)

Rediscovered live residuals of landed v1 fixes; the v1 IDs stay `DONE` in the
archive, these rows own the remaining gap.

| ID  | Phase                                            | Target fix                                                        | Status  |
| --- | ------------------------------------------------ | ------------------------------------------------------------------ | ------- |
| K1  | [2](phases/phase-2-server-corpus-ring-2.md)      | Wire `chatScopedRead` into generation finalization persist (v1-L6 residual). | DONE    |
| K2  | [2](phases/phase-2-server-corpus-ring-2.md)      | Message-free/scoped load for the asset-GC sweep (v1-M10 residual). | DONE    |
| K3  | [7](phases/phase-7-opt-in-subsystems.md)         | Check `blobUrlCache` before fetching asset bytes (ordering only; bulk-byte route stays gated). | PENDING |
| K4  | [4](phases/phase-4-client-clone-ring-2.md)       | Debounce/scope the lorebook editor per-keystroke collection clone (v1-L32 residual). | PENDING |

### Informational

All routed `no action` (inventory). Evidence in the audit's
[Informational Findings](audit-stability-and-performance-v2.md#informational-findings)
section. I3 (unused `created_at` index) may ride Phase 8 and I16 (parser
nesting-stack cap) may ride Phase 3 if free; neither is required.

| ID  | Routing   | Note                                                              |
| --- | --------- | ----------------------------------------------------------------- |
| I1  | no action | Done-in-grace reattach destroys the job for a second viewer.      |
| I2  | no action | `getModuleTriggers` rebuilt per edit-hook context build.          |
| I3  | no action | Unused `idx_command_events_created_at` write-amplification.       |
| I4  | no action | SSE replay maps the full `command_events` table per reconnect.    |
| I5  | no action | `inflateBounded` ~2x peak memory for within-cap payloads.         |
| I6  | no action | SigV4 hashes the full body synchronously per Bedrock request.     |
| I7  | no action | O(buflen^2) delimiter scan, bounded by the 8 MB cap.              |
| I8  | no action | Horde poll loop fixed-interval on a route no SPA path uses.       |
| I9  | no action | Vertex token-exchange error embeds the raw upstream body.         |
| I10 | no action | Inlay-marker regex scan of the transcript per server send.        |
| I11 | no action | `evaluateIgp` appends `'[object Object]'` (verbatim port).        |
| I12 | no action | Double `parseAdditionalAssets` when editdisplay changes text.     |
| I13 | no action | RegexList unkeyed each churn; no data corruption.                 |
| I14 | no action | BookmarkList Map rebuild per message change while open.           |
| I15 | no action | `claudeObserver` permanent 20 s interval (self-limiting).         |
| I16 | no action | Parser 512-deep nesting stack silently mis-parses past 512.       |
| I17 | no action | `voiceDetector` leaks, but is dead code (delete before reuse).    |
| I18 | no action | MCP duplicate tool names dispatch first-match.                    |

## Gated / Owner-Decision

Keep these gated on `RISU_PROTOCOL_METRICS` evidence or owner approval.

- L12 - fresh-boot Lua runs serialize behind active runs. This is the
  documented wasmoon shared-wasm boot constraint (egress is already capped at
  10 s per call); raising `LUA_ENGINE_POOL_TARGET` is an owner decision.
- v1 carry-overs (owned by the
  [archived v1 risk analysis](../archive/audit-stability-and-performance/active-risk-analysis.md)):
  v1-L4 (var-write full-table persist breadth, re-confirmed low), v1-L7
  (Tier-5 create/delete floor — note H2 is explicitly NOT under this gate),
  v1-L26 (streaming `.risu` export), v1-U2 (full-bootstrap fallback,
  re-confirmed info).
- `leftover.md` evidence gates re-confirmed by v2 known-overlap candidates and
  unchanged: prompt-assembly hydrated load + `finalizeRequestBudget`
  re-tokenize, bootstrap full load, per-asset byte fanout (K3 fixes only the
  cache ordering), v1-L17 within-batch blocking, v1-U2 serial replay, and the
  v1-H3 token string re-accumulation.

L3, L21, L25, and L31 carry `[KL]` notes in the audit; their scheduled rows
above are bounded sub-wins that do not re-open the parent gates.

## Source Anchors

- Server corpus paths: `server/fastify/src/commands/mutations.ts`
  (`applyJsonCommandMutation`, `applyTargetedCommandMutation`,
  `chatScopedRead`), `repository.ts`, `routes/commands.ts`,
  `routes/projection.ts`, `routes/generationChat.ts`
  (`persistServerGenerationResult`), `routes/realmImport.ts`, `assetGc.ts`.
- Assembly CBS/triggers: `server/fastify/src/prompt/assemble.ts`
  (`captureMessageReplacement`), `history.ts` (`formatHistoryMessage`),
  `templates.ts` (`renderContentCard`), `lorebook.ts`, `triggers.ts`,
  `triggerDataEffects.ts`, `src/ts/cbs.ts`, `src/ts/parser/risuChatParser.ts`.
- Client clones/state: `src/ts/process/request/serverMessagePatch.ts`,
  `src/ts/plugins/plugins.svelte.ts` (`pluginStorage`),
  `src/ts/chatCommands.ts` (`changedChatMetadata`), `src/ts/moduleCommands.ts`,
  `src/ts/process/command.ts`, `src/ts/characters.ts`, `src/lang/index.ts`.
- Render/UI: `src/ts/stores.svelte.ts` (`ReloadGUIPointer.subscribe`),
  `src/lib/ChatScreens/Chat.svelte` + `ChatBody.svelte`,
  `src/ts/process/scripts.ts` (`resetScriptCache`),
  `src/lib/Setting/Pages/PromptSettings.svelte`, `src/ts/observer.svelte.ts`.
- Bridges/lifecycle: `src/ts/server/lorebookBridge.svelte.ts`,
  `characterBridge.svelte.ts`, `src/ts/bootstrap.ts`,
  `src/ts/storage/database.svelte.ts` (`mergeServerProjectionCharacterRow`),
  `src/ts/process/prereroll.ts`.
- Opt-in subsystems: `src/ts/translator/translator.ts`,
  `bergamotTranslator.ts`, `src/ts/process/tts.ts`, `src/ts/process/mcp/`,
  `src/ts/process/processzip.ts`, `src/ts/process/files/`,
  `src/ts/characterCards.ts`, `src/ts/parser/parser.svelte.ts`
  (`blobUrlCache`).
- Server bounds: `server/fastify/src/streamJobs.ts`,
  `generationFinalizationRetry.ts`, `db.ts`, `memory*.ts`,
  `routes/hub.ts`, `routes/legacyStorage.ts`, `risuSave/bundleExport.ts`,
  `generation/vertexAuth.ts`, `routes/proxy.ts`.
- Reference templates: `chatScopedRead`/`loadPersistedForChatMutation`
  (scoped mutation reads), the fork route's writer kit (targeted chat
  writes), scalar/single-row snapshots, `getCompiledRegex` + the
  `PreparedScript` memo, `requestAbort.ts` deadlines, `boundedInflate.ts`.

## Dismissed Candidates

These were adversarially verified as non-issues against current code (full
refutations in the audit's
[Investigated And Dismissed](audit-stability-and-performance-v2.md#investigated-and-dismissed)
section):

- R1 - durable submission-lock leak on attach throw: no synchronous throw site
  exists between register and trackRunner.
- R2 - `promptScope` race across awaits: scope set/used/cleared synchronously
  inside `expandVariables`.
- R3 - `LuaExecBudget` straddling the provider call: `usedMs` accumulates only
  actual Lua run time.
- R4 - fresh-engine boot failure crashes the route: both entry points wrap
  assembly in try/catch.
- R5 - memory selection eagerly decodes embeddings per generation: the only
  live caller wires empty query vectors.
- R6 - embedding rate limiter not shared: batch handlers dispatch exclusively;
  one worker, one limiter.
- R7 - SSE adapters let one huge complete event through: the 8 MB cap trips
  while the event accumulates.
- R8 - SSE reader drains after non-abort cancel: the trigger is unreachable on
  the live runtime.
- R9 - regex memo wiped per GUI reload as a standalone finding: folded into
  H3 (the `bestMatchCache` claim was wrong).
- R10 - memory-worker fairness `now` skew: mechanically true, no consequential
  unfairness.
- R11 - MCP `customTransport` leak: dead code, never assigned.
- R12 - PNG import uploads one giant JSON body: uploads are chunked at
  32 items / 32 MB.
- R13 - `getInlayAsset` re-fetch per assembly: dead local-assembly arm.

## Non-Goals

- Do not change projection/bootstrap/revision/event wire model, `.risu` bytes,
  rendered output, or persisted state (L22's embedding-window fix is the one
  scheduled semantic correction, and it must be explicit and tested).
- Do not remove broad SQLite loaders or full-collection snapshots. Keep them
  for true full-corpus consumers.
- Do not schedule L12 or the v1 carry-over gates without evidence or owner
  approval.
- Do not re-open dismissed candidates (R1-R13) or v1's R-set without new
  evidence.
