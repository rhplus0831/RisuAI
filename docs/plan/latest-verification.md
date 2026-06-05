# Latest Verification

Date: 2026-06-05

This is the maintained proof-command log for the workstream. Update it after
each phase or focused batch.

## Baseline (Phase 0 complete)

Re-run after both Phase 0 slices (fixture + server load-count harness +
fix-completeness gate scaffold; test-only, no runtime change):

- `pnpm test` — 1067 passed / 4 skipped (client suite; +5
  `largeCorpusFixture.test.ts`, +8 `fixCompletenessGate.test.ts`).
- `pnpm api:test` — 1639 passed / 1 skipped (server suite; +7
  `serverLoadCostHarness.test.ts`).
- `pnpm client-thinning:audit` — green.
- `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit` — zero errors.

Pre-slice numbers (through `6861494d`): 1054/4 client, 1632/1 server, audit
green, zero tsc errors, `pnpm check` at the pre-existing 10-error svelte-check
baseline (outside this workstream).

## Pre-Fix Fixture Measurements (Phase 0, 2026-06-04)

Recorded from the shared large-corpus fixture before any fix lands.

- Load counts (default fixture size;
  `RISU_PROTOCOL_METRICS=1 pnpm exec vitest run --config
server/fastify/vitest.config.ts --reporter=verbose serverLoadCostHarness`):
  - Scoped hydration (hot chat, messages + hypaV3Data): **0 corpus loads**.
  - H1 fallback hydration (chat without a `chat_hypa_v3` row): **13
    whole-corpus payload loads** — characters, chats, all 9 collection tables,
    plugin_custom_storage, assets — for one chat's messages.
- Wall-clock at scale (one-off `tsx` run; 40 characters x 100KB cards, 4
  chats each, hot chat 1500 x 400B messages; 9.6MB corpus JSON; warmed, 5
  runs):
  - Hot chat hydration (scoped, 1500 messages): ~8ms — all payload.
  - No-hypa chat hydration (60 messages, H1 fallback): **~13ms** — a 25x
    smaller chat costs more than the hot chat because the fallback re-parses
    the whole corpus; scales with total character-card bulk, which is why real
    corpora saw multi-second stalls.
- The load _count_ is the durable gate signal; the timings document why the
  counts matter.

## Post-Fix Measurements

- Phase 1 H1 (`0dc7452e`): no-hypa chat hydration on the default fixture is now
  **0 corpus loads, ~1.6ms** (was 13 loads; ~13ms at the 9.6MB scale corpus).
  The zero-row not-yet-extracted fallback keeps its documented breadth
  (regression-tested in `serverLoadCostHarness.test.ts`).
- Phase 1 H3 (`e41dc6c6`): a synthetic 200-token stream performs **≤2
  editoutput parses / display writes** (`reloadKeys` ≤4 including setup +
  finally) instead of 200 each; final text byte-identical. Real-stream parse
  count is now bounded by frames-per-second × stream duration, not token
  count.
- Phase 1 H2 (`067ab82a`): chat select captures **zero clone-primitive calls**
  (`totalCloneCount` 0) instead of a whole-characters JSON clone per click;
  the `changeChatTo` end-to-end gate proves no clone at the size of the
  characters array on either the index or the id path.
- Phase 2 M1/L1/L2 (`c193c008`): a preview/send assembly performs **zero
  whole-corpus `messages`/`chat_hypa_v3` payload reads** (was: both tables
  parsed whole per send/continue/regenerate/preview) — only the target chat's
  rows plus the character/collection tables load, so `databaseLoadMs` no
  longer scales with transcript corpus size. The loader-equivalence test
  proves the target chat hydrates byte-identically and every sibling gets
  `message=[]`. L1: the ~8 per-assembly `getActiveModules` scans hit one memo
  entry. L2: marker-free message bodies skip the per-message parser pass as
  proven fixed points.
- Phase 2 M3/L5/L6 (`e0e86ab1`): a message/scriptstate/generation command
  mutation performs **zero whole-corpus payload reads of any table** (was: 13
  whole-corpus payload reads per mutation — characters, chats, all 9
  collection tables, plugin storage, assets — to locate one chat row). The
  scoped read parses exactly one chat row + one character row; the loader
  equivalence test proves identical records, and unknown-id / pre-extraction
  states keep the documented broad fallback.
- Phase 2 M4 (`254b3112`): a `characterRow` projection performs **zero
  whole-corpus payload reads** (was: a whole characters+chats table parse plus
  a JSON deep clone of the entire masked array to `.find()` one row). The
  single-row loader is proven byte-identical to the pre-M4 broad composition
  for every character on the multi-character fixture (including lorebook-stub
  and TTS-secret masking), the embedded-characters fallback is kept, and
  bootstrap's in-place mask ships the same bytes while on-disk secrets stay
  unmasked.
- Phase 2 M5/L10/U1 (`b2765994`) — PHASE 2 COMPLETE: with metrics off, a
  projection/bootstrap response is serialized **once** instead of twice
  (exact +1 accounting proves the deferred `jsonPayloadBytes` runs only when
  `RISU_PROTOCOL_METRICS` is on, with identical metric output). A fresh
  no-replay SSE connect performs **zero corpus reads of any table** (was: the
  full command-event history read+mapped per connect); replay and metrics-on
  connects keep the load. Bulk chat/lorebook hydration performs **zero
  whole-corpus payload reads** for any extracted corpus — known ids, missing
  ids, and legacy embedded-message rows all resolve from the requested rows
  (was: a full `loadPersisted` per bulk call); per-row payloads proven
  equivalent to the single hydration routes, pre-extraction databases keep
  the broad fallback.
- Phase 3 M12-M14/L31-L36/U4 (`0efa7ba6` + L32 follow-up) — PHASE 3 COMPLETE:
  `/setvar` and
  `/addvar` run **zero** `setDatabase` normalizer passes per var write (was 1
  each — an O(characters) re-filter plus, on non-English UIs, a ~99 KB
  language-pack deep clone+merge); `/send` keeps its normalizer (boundary
  test). `changedCharacterFields` / `prepareCompatibleCharacterUpdate` diff
  without serializing the `chats` payload (was 2 whole-character clones per
  field diff). The send-context, chat-module-toggle, MCP-character-patch, and
  `setCurrentChat` rollbacks each capture **one row/chat** instead of the
  whole characters array, and the rollback tests prove sibling concurrent
  edits survive a failed command. A character-scoped script-definition
  watcher fire stringifies **only the selected character's rows** (sibling
  scripts never serialized; module scope likewise); the discrete LoreBook
  editor actions capture a **single-collection** scoped snapshot and id-assign
  only the edited collection (sibling id-less entries proven untouched). The
  L32 follow-up scopes watcher/global-modal first-run ID assignment:
  character-scoped mounts assign IDs only on the selected character's hydrated
  `globalLore` and chats, global-scoped mounts assign IDs only on the global
  lorebook list, and `lorepreset.svelte` no longer calls the broad
  `ensureAllClientLorebookIds()` on mount. The
  modules `$effect` performs **zero clone-primitive calls** for its
  dependency read and no longer re-runs on unrelated deep module edits. A
  rejected command factory now **rolls back once and resolves to an error
  result** (was: unhandled rejection, optimistic write silently diverged).
- Phase 5 M9-M11/L11-L15/L27-L30 (`686220d6`) — PHASE 5 COMPLETE: a 64 MiB
  gzip-bomb inflate against a 1 MiB cap now **aborts within one 4 KiB push
  step of the cap** (the spy observed < 16 MiB ever materialized; was: full
  expansion before the check) for legacy-compressed/stream envelopes and
  per-block (cumulative budget) for RISUSAVE blocks, and `/import/bundle`'s
  inner `database.risu` is **finitely capped by default** (rejected at 400
  even with an unlimited bundle ceiling). Asset GC and the import asset
  report perform **zero whole-corpus `messages`/`chat_hypa_v3` payload
  reads** (was: a full `loadPersistedWithMessages` hydrate + per-row
  `JSON.parse` every 15-min sweep and after every import) with the report
  proven byte-identical to the hydrated walk. An aborted in-flight bundle
  download **frees the asset FD and terminates the Zip** (read stream proven
  destroyed; the test fails pre-fix by parking forever). A done-job WS
  viewer is **closed by the server and the job unpinned** (re-attach 404s).
  Shutdown **settles detached runners before `db.close()`** — the
  cancel-persist of an in-flight generation lands durably (test fails
  pre-fix). Durable SSE viewers emit comment heartbeats during silent
  windows (never entering the replay buffer); a no-viewer proxy job whose
  pending window dropped frames **aborts its upstream** instead of draining
  the response. A corrupt backup manifest no longer 500s the list; a failed
  legacy `db.json` restore re-import **rolls the whole restore back** with
  no `stateRestored` event (was: tables already swapped + event persisted).
  Replayed command events **carry `origin.writerSessionId`** identical to
  the live emit (schema v15), and a reattach trigger arriving mid-stream
  defers and re-fires so the second live-job chat reattaches (test fails
  pre-fix).
- Phase 6 M7/L16-L19/L21 (`ca798c01`) — PHASE 6 COMPLETE: an embed/summarize
  tick drains **at most 32 jobs** (33 seeded → 32 complete + 1 pending for the
  next tick; was: the whole backlog in one batch), and a `voyageContext3`
  contextual run splits into **token-aware sub-batches committed
  independently** — a failing sub-batch retries alone while the next
  sub-batch's embeddings land (was: one request carrying every pending
  chunk's text, all-or-nothing). Generation-time orphan cleanup on a chat
  with no summaries performs **no summary metadata re-parse and opens no
  `BEGIN IMMEDIATE`** (id-only EXISTS probe; was: a write txn + full summary
  parse per generation even when nothing was orphaned). A two-chat queue
  serves **A,B,A,B,A** instead of all of A then B (round-robin claim;
  single-chat order unchanged). A memory batch performs **zero whole-corpus
  payload reads** — only the settings row, the `hypa_v3_presets` table, and
  id-only character/chat stubs load (was: a full `loadPersisted` —
  characters+chats+9 collection tables+assets — per batch), with unknown-chat
  errors byte-identical through the scoped stubs. Three runaway `triggerlua`
  hooks under a 300ms aggregate budget finish in **well under one per-run
  limit** (was: ~9s — 3 hooks × the 3s per-run limit; the budget exhausts
  and later runs short-circuit before any engine boots). A default-limit Lua
  run acquires a **pre-warmed engine with zero hot-path boots** (acquire
  stats prove pool service; pooled vs fresh outputs byte-identical; a global
  planted by one run reads `nil` in the next — isolation preserved); locally
  the Lua/trigger suites dropped from ~16s to ~1.4s wall. Gotcha (guarded in
  code + proven by the L21 tests passing): booting engines on wasmoon's
  shared wasm module while another engine has a pending `:await()`
  continuation crashes with "null function or function signature mismatch" —
  every boot (background refill *and* a run's fresh boot) serializes behind a
  shared boot gate and starts only while no run is in flight, with the run
  counted active atomically with its engine claim (completion-audit closeout:
  a run suspended in an in-flight `:await()` defers a concurrent custom-limit
  run's fresh boot until it drains; the regression fails pre-fix at the
  boot-overlap assertion).
- Phase 4 M6/M8/L20/L22-L25 (`bf1a6cb2`) — PHASE 4 COMPLETE: a client
  disconnect mid-`/proxy/fetch` now **aborts the upstream connection**
  (proven by holding an upstream open and destroying the client socket; the
  test fails without the fix), and the server carries an explicit 600s
  `requestTimeout` backstop. Every non-durable provider signal
  (buffered + streaming, both generation route files) is bounded by the
  durable-reference **600s deadline at the signal source**, and all buffered
  provider bodies fail closed past **32 MB** (over-cap adapter test streams
  33 MB and gets a bounded `fail`). An aborted request **cancels in-flight
  Lua hook work** at the next host-fn call/yield instead of running to the
  exec limit (an abort at 100ms ends a 60s-budget run in well under 5s, no
  engine boots once aborted). A delimiter-less streaming upstream yields
  **one bounded error frame at 8 MB** instead of unbounded buffer growth
  (SSE + NDJSON shapes). The IPv6 SSRF guard blocks the previously-bypassing
  embedded-private forms (`::ffff:7f00:1` hex-mapped, `::7f00:1` compatible,
  `2002:7f00:1::` 6to4, `64:ff9b::7f00:1` NAT64) while public transition
  forms stay reachable. `setObjectValue` drops
  `__proto__`/`constructor`/`prototype` key segments (no `Object.prototype`
  pollution from the additionalParams DSL), and 40 blocked Lua `request()`
  calls now consume **zero** egress budget (was: full window starvation).

## How To Reproduce The Costs Being Fixed

- Server stage timings (H1, M1, M3, M4, M5, M10): run server tests with
  `RISU_PROTOCOL_METRICS=1` and `RISU_COMMAND_METRIC_SUMMARY=1` on the Phase 0
  fixture. Watch `databaseLoad*`, `projection_response`, and command metrics.
- Static corpus cost: `pnpm analyze:db <input>` (`util/analyze-database.ts`)
  reports export materialization, bootstrap payload size, and asset fanout.
- Client per-token cost (H3): browser profiler during a long streamed response;
  `ParseMarkdown` / `risuChatParser` self-time should grow with message length
  before the fix and stay bounded after.
  `localStorage.setItem('risu:protocol-debug','1')` adds client protocol logs.

## Run Log

| Date       | Scope                                                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-04 | Plan opened; no runtime change                                                                                   | Baseline carried from `6861494d` (above); not re-run as part of writing the plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-06-04 | Phase 0 measurement-baseline-harness slice (test-only)                                                           | `pnpm test` 1059/4, `pnpm api:test` 1639/1, audit green, both tsc checks zero errors. Pre-fix fixture measurements recorded above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-06-04 | Phase 0 fix-completeness-gate-scaffold slice (test-only) — PHASE 0 COMPLETE                                      | `pnpm test` 1067/4 (+8 `fixCompletenessGate.test.ts`), audit green, both tsc checks zero errors. Server suite untouched (1639/1 carried). Drift behavior hand-verified: doc-DONE-only, new audit id, phase reroute each fail one self-check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-06-04 | Phase 1 H1 slice (`0dc7452e` fix + gate/doc flip)                                                                | `pnpm api:test` 1640/1 (+1 zero-row fallback regression; H1 control flipped to `assertScopedLoadOnHotPath`), `pnpm test` 1067/4 (gate flip, no count change), audit green, both tsc checks zero errors. No-hypa hydration: 0 corpus loads (was 13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-06-04 | Phase 1 H3 slice (`e41dc6c6` fix + gate/doc flip)                                                                | `pnpm test` 1077/4 (+7 `streamCoalescer.test.ts`, +3 `streamResponse.test.ts` H3 block), `pnpm api:test` 1640/1 (carried), audit green, both tsc checks zero errors. 200-token stream: ≤2 parses (was 200).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-06-04 | Phase 1 H2 slice (`067ab82a` fix + gate/doc flip) — PHASE 1 COMPLETE                                             | `pnpm test` 1084/4 (+4 `chatCommands.test.ts` H2 block, +3 `globalApi.changeChatTo.test.ts`), `pnpm api:test` 1640/1, audit green, both tsc checks zero errors. Chat select: 0 clone calls (was a whole-characters clone per click).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-06-04 | Phase 2 scoped-assembly-load slice (`c193c008` fix + gate/doc flip)                                              | `pnpm api:test` 1651/1 (+3 M1 `serverLoadCostHarness.test.ts`, +6 L1 `modulesMemo.test.ts`, +2 L2 `assemble.test.ts`), `pnpm test` 1084/4 (gate flip, no count change), audit green, both tsc checks zero errors. Assembly: 0 whole-corpus message/hypa reads (was 2 whole-table parses per send/preview).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-06-04 | Phase 2 command-mutation-read-narrowing slice (`e0e86ab1` fix + gate/doc flip)                                   | `pnpm api:test` 1657/1 (+6 `commandMutationReadNarrowing.test.ts`), `pnpm test` 1084/4 (gate flip, no count change), audit green, both tsc checks zero errors. Message/scriptstate/generation mutation: 0 whole-corpus payload reads (was 13 per mutation).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-06-04 | Phase 2 single-character-projection slice (`254b3112` fix + gate/doc flip)                                       | `pnpm api:test` 1664/1 (+5 M4 `serverLoadCostHarness.test.ts`, +2 `providerSecrets.test.ts`), `pnpm test` 1084/4 (gate flip, no count change), audit green, both tsc checks zero errors. `characterRow` projection: 0 whole-corpus payload reads + no whole-array mask clone (was a full characters+chats parse + whole-array deep clone per request); bootstrap drops its whole-stubbed-DB mask clone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-06-04 | Phase 2 projection-metric-and-bulk-read slice (`b2765994` fix + gate/doc flip) — PHASE 2 COMPLETE                | `pnpm api:test` 1671/1 (+8 M5/L10/U1 `serverLoadCostHarness.test.ts` tests, −1 replaced U1 breadth control), `pnpm test` 1084/4 (gate flip, no count change), audit green, both tsc checks zero errors. Metrics-off responses serialized once (was twice); fresh SSE connect 0 corpus reads (was full event-history read+map); bulk hydration 0 whole-corpus reads for extracted corpora (was full `loadPersisted` per call).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-06-04 | Phase 3 client-clone-narrowing batch (`0efa7ba6` fix + gate/doc flip) — mostly landed; L32 follow-up later found | `pnpm test` 1117/4 (+33: M12 `command.projectionGuard.test.ts`, M13 `characterCommands.test.ts`, M14 `sendChatContext.test.ts`, L31 `scriptDefinitionBridge.svelte.test.ts`, L32 `lorebookBridge.test.ts`, L33 `stores.modulesEffect.svelte.test.ts`, L34 `moduleCommands.test.ts`, L35 `characters.setCharacterInfo.test.ts`, L36 `commands.test.ts`+`chatCommands.test.ts`, U4 `chatCommands.test.ts`), `pnpm api:test` 1671/1 (carried, client-only change), audit green, both tsc checks zero errors, `pnpm check` at the carried 13-error baseline (outside this workstream). Var writes: 0 normalizer passes (was 1 + language-pack clone); character field diff: no chats serialization (was 2 whole-char clones); send/toggle/MCP/setCurrentChat rollbacks: one row (was whole corpus); scoped watcher/editor helper scans; modules `$effect`: 0 clones; rejected factories roll back. Re-audit note: L32 needed mount-time ID-assign narrowing for scoped lorebook watcher/global-modal mounts. |
| 2026-06-04 | Phase 3 L32 watcher/global-modal follow-up — PHASE 3 COMPLETE                                                    | `pnpm test -- src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/lorebookBridge.test.ts src/ts/__tests__/fixCompletenessGate.test.ts` completed the client suite at 1121/4 (new L32 mount-time watcher/global-modal regressions + Phase 8 gate update; noisy `127.0.0.1:3000` connection-refused logs did not fail the run), `pnpm client-thinning:audit` passed, `pnpm exec tsc -p tsconfig.client-lib.json` passed, `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit` passed. Scoped lorebook watcher mounts now initialize IDs only for the watched scope; the global lorebook modal uses the global-list-only ensure.                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-06-05 | Phase 4 outbound-request-lifecycle batch (`bf1a6cb2` fix + gate/doc flip) — PHASE 4 COMPLETE                     | `pnpm api:test` 1692/1 (+21: `requestAbort.test.ts` 6, `generationBodyCap.test.ts` 6, `luaRuntime.test.ts` +4 L20/L23/L25, `proxy.test.ts` +2 M6, `openai.test.ts` +1 and `ollama.test.ts` +1 L22, `additionalParams.test.ts` +1 L24), `pnpm test` 1121/4 (gate flip, no count change), audit green, both tsc checks zero errors. M6 disconnect test proven failing without the fix (negative control re-run). Disconnect mid-proxy-fetch aborts upstream; non-durable provider signals bounded at 600s + 32 MB body cap; Lua runs cancel on the request signal; streaming buffers capped at 8 MB; embedded-IPv4 IPv6 forms blocked; prototype keys rejected; blocked URLs no longer consume egress budget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-06-05 | Phase 5 materialization-and-lifecycle batch (`686220d6` fix + gate/doc flip) — PHASE 5 COMPLETE                  | `pnpm api:test` 1714/1 (99 files; +23: `risuSaveBoundedInflate.test.ts` 5, `risuSaveBundleImportRoute.test.ts` +1 M9 cap, `assetGc.test.ts` +2 M10, `risuSaveBundleExportRoute.test.ts` +1 M11, `events.test.ts` +2 L11/L29, `streamJobsRoutes.test.ts` +1 L12, `durableGeneration.test.ts` +2 L13/L14, `streamJobs.test.ts` +1 L15, `backups.test.ts` +2 L27/L28), `pnpm test` 1122/4 (+1 `reattach.test.ts` L30; gate flip), audit green (EC6 message-inlay relocation kept exempt via the named `addMessageInlayReferenceSources` helper), both tsc checks zero errors. Negative controls re-run: M11 parks forever pre-fix, L13 loses the cancel-persist pre-fix, L30 drops the deferred trigger pre-fix. Bounded inflate aborts at the cap mid-stream; GC/report drop the whole-corpus message hydrate (report byte-identical); restore re-import atomic; replay carries writer origin; schema v15 adds `command_events.origin_writer_session_id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-06-05 | Phase 6 memory-and-lua batch (`ca798c01` fix + gate/doc flip) — PHASE 6 COMPLETE                                 | `pnpm api:test` 1728/1 (99 files; +14: `memoryEmbedJobHandler.test.ts` +4 M7 cap/split/independent-commit + L18, `memorySummarizeJobHandler.test.ts` +2 L18, `memoryRepository.test.ts` +2 L16, `memoryWorker.test.ts` +2 L17, `luaRuntime.test.ts` +4 L19/L21), `pnpm test` 1122/4 (gate flip, no count change), audit green, both tsc checks zero errors. Batch drain capped at 32/tick; contextual sub-batches commit independently; no-orphan cleanup opens no write txn; two-chat queue alternates A,B,A,B,A; memory batch loads 0 whole-corpus payloads (only `hypa_v3_presets` whole, by design); 3 runaway hooks bounded by the 300ms test budget (~9s before); default-limit Lua runs serve from the warm pool with 0 hot-path boots, outputs byte-identical, cross-run global leakage `nil`. wasmoon gotcha guarded: pool refills only while idle (boots during a pending `:await()` continuation crash the shared wasm module).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
