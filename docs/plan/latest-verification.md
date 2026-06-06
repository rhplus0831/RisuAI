# Latest Verification

Date: 2026-06-06

This is the maintained proof-command log for the v2 workstream. Update it
after each change to a narrowed or bounded path.

## Current State

- Plan state: open. Phase 1 H1-H3, Phase 2's M5, M6, L3, L13, L14, L16, K1,
  and K2, Phase 3's M1-M4 and L4-L11, and Phase 7's M15, M16, M18-M22,
  L48-L59, and K3 are implemented and proof-refreshed. Phase 4 remains the
  next fix batch.
- Gate state: the v1 gate
  (`src/ts/__tests__/fixCompletenessGate.test.ts`) stays live against the
  archived v1 docs. The v2 gate
  (`src/ts/__tests__/fixCompletenessGateV2.test.ts`) is live against the v2
  docs and active-risk routing.
- Scheduled IDs: H1-H3 plus Phase 2's M5, M6, L3, L13, L14, L16, K1, and K2,
  Phase 3's M1-M4 and L4-L11, and Phase 7's M15, M16, M18-M22, L48-L59, and
  K3 are registered `DONE` in the v2 gate and
  [`active-risk-analysis.md`](active-risk-analysis.md). Remaining scheduled
  gate entries stay `PLANNED`; remaining risk-map rows stay `PENDING`;
  gated/no-action rows are unchanged.

## Baseline (carried from the v1 close)

Recorded at the v1 plan close (2026-06-05, `ea0dc34a`), re-confirmed as the
v2 starting point:

- `pnpm test`: 1132 passed / 4 skipped (122 files).
- `pnpm api:test`: 1737 passed / 1 skipped (99 files).
- `pnpm client-thinning:audit`: green.
- TypeScript: `tsconfig.client-lib.json` and `server/fastify/tsconfig.json`
  both zero errors (re-run clean on 2026-06-05 before the v2 audit).
- `pnpm check` retains its pre-existing svelte-check baseline outside this
  workstream.

The Phase 0 refresh later in this file is the no-runtime-change baseline
before the first runtime fix.

## Phase 1 Verification Refresh

Recorded on 2026-06-06 KST after H2, H3, and H1 landed. H1-H3 were confirmed
as `DONE` in both `src/ts/__tests__/fixCompletenessGateV2.test.ts` and
[`active-risk-analysis.md`](active-risk-analysis.md).

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts server/fastify/__tests__/serverLoadCostHarness.test.ts`:
  passed, 2 files / 31 tests. H2 proof: chat-create asserted
  `loadCountByTable.messages === 0` and
  `loadCountByTable.chat_hypa_v3 === 0`; the load-cost harness also asserted
  zero hydrated message/hypa loads and no full-hydrated-database clone-sized
  stringify (`maxStringifiedSize < fullHydratedDatabaseSize * 0.75`).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/triggers.test.ts`:
  passed, 1 file / 67 tests. H1 proof: never-breaking `v2Loop` stopped at
  `maxLoopBackEdges=5` with count `<=6`; huge `v2LoopNTimes` stopped at
  `maxLoopBackEdges=4` with count `<=5`; low-level self-recursion with
  `maxRecursionDepth=3` stayed at `effectSteps <= 4`; AbortSignal stopped a
  running loop with `stoppedReason === 'aborted'`.
- `pnpm exec vitest run src/ts/process/__tests__/streamResponse.test.ts src/ts/process/triggers.regexMemo.test.ts`:
  passed, 2 files / 18 tests. H3 proof: a 200-token stream stayed bounded at
  `processScriptFull` calls `<=2` and `reloadKeys <=4`; `v2UpdateGUI`
  preserved the broad `ReloadGUIPointer`, bumped only
  `VariableReloadGUIPointer + 1`, and kept compiled regex/cache identity;
  `v2RegexTest` compiled once after the first pass and remained at one compile
  across the second variable-only refresh.
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 2 files / 26 tests. The frozen v1 gate and live v2 gate are green;
  the v2 gate expects H1-H3 as the only `DONE` scheduled entries.
- `pnpm test`: passed, 125 files; 1155 passed / 4 skipped (1159). The run
  printed repeated `ECONNREFUSED 127.0.0.1:3000` noise from local-service
  probes but exited 0.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMessageFreeCeiling.test.ts`:
  passed, 1 file / 9 tests. The H2 chat-create ceiling assertion now expects
  `targeted-character-row`, still rejects a duplicate message id via the
  active-message uid index, and asserts writes are limited to
  `characters`, `chats`, and `messages`.
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 1 file / 18 tests.
- `pnpm api:test`: passed, 99 files; 1744 passed / 1 skipped (1745).
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: passed with zero diagnostics.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: passed with zero
  diagnostics after the client-lib build.

Focused H1-H3 assertions, both gates, root test, client-thinning audit, and
TypeScript checks are green. Full API-suite proof is green with the H2
targeted chat-create expectation in `commandMessageFreeCeiling.test.ts`.

## Phase 2 Verification Refresh

Recorded on 2026-06-06 KST after M5, M6, L3, L13, L14, L16, K1, and K2
landed. Those Phase 2 IDs are confirmed `DONE` in both
`src/ts/__tests__/fixCompletenessGateV2.test.ts` and
[`active-risk-analysis.md`](active-risk-analysis.md). The focused runtime
proofs, gates, root test suite, API suite, client-thinning audit, and
TypeScript checks passed. The initial audit blocker was fixed by making
character PATCH build an id-preserving patched row instead of calling the
import/bootstrap repair helper that can mint ids.

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/serverLoadCostHarness.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts server/fastify/__tests__/projection.test.ts server/fastify/__tests__/assetGc.test.ts`:
  passed, 4 files / 88 tests.
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMetrics.test.ts`:
  passed, 1 file / 1 test. The default Vitest reporter did not print the
  optional JSON summary, but the test asserted the measured command families:
  settings -> `targeted-settings`, plugin storage ->
  `targeted-plugin-storage`, chat PATCH -> `targeted-chat-row`, character
  select -> `targeted-character-selection`, message families ->
  `targeted-message` with `dbJsonWriteMs === 0`, generation ->
  `targeted-generation`, and narrowed written-table sets.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/messageStore.test.ts server/fastify/__tests__/realmImport.test.ts server/fastify/__tests__/auth.test.ts`:
  passed, 5 files / 171 tests.
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 2 files / 26 tests. The live v2 gate expects H1-H3 plus M5, M6,
  L3, L13, L14, L16, K1, and K2 as the only scheduled `DONE` entries.
- `pnpm test`: passed, 125 files; 1155 passed / 4 skipped (1159). The run
  printed repeated `ECONNREFUSED 127.0.0.1:3000` local-service probe noise but
  exited 0.
- `pnpm api:test`: passed, 99 files; 1765 passed / 1 skipped (1766).
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
  The previous A4R3 blocker on
  `PATCH /api/v1/commands/characters/:characterId` is fixed; the command path
  no longer calls `repairCharacterCollectionRow()`.
- `pnpm exec tsc -p tsconfig.client-lib.json`: passed with zero diagnostics.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: passed with zero
  diagnostics after the client-lib build.
- Blocker-remediation focused re-run:
  `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts server/fastify/__tests__/serverLoadCostHarness.test.ts`
  passed, 3 files / 148 tests;
  `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts`
  passed, 1 file / 18 tests; code Prettier check, both TypeScript checks, and
  `git diff --check` passed.

Phase 2 focused proof summaries:

- M5: character PATCH and non-module chat PATCH stayed scoped with
  `corpusLoadCount === 0`, wrote only the target row, preserved sibling rows,
  and kept the explicit broad fallback only for `patch.modules`.
- M6/L16: `preset`, `plugin`, and `moduleEnabled` field projections were
  byte-identical to broad composition with `characters === 0` and `chats ===
  0`; both bulk projection routes returned 401 without auth and verified an
  authenticated request exactly once.
- L3/L13/K1/K2: server-intent completion, Realm character append, and
  message-only generation finalization all reported `corpusLoadCount === 0`
  with zero whole-corpus character/chat/message payload loads. Asset GC read
  asset metadata once, deleted only the orphan asset, and recorded zero
  character/chat/message/hypa and collection-table payload hydrates.
- K1 broad-path guard: chat-variable generation finalization intentionally
  kept the broad write path, loaded character/chat rows, loaded no messages,
  and reported `mutationPath: targeted-generation`, `dbJsonWriteMs: 0`, and
  broad-table writes plus `messages`.
- L14: append-only transcript persistence recorded `stableEqualCalls === 0`,
  `stableEqualStringifies === 0`, and `appendFastPathRows === 1`; edit and
  truncate replacements still exercised the generic diff path.

## Phase 3 Verification Refresh

Recorded on 2026-06-06 KST after M1-M4 and L4-L11 landed. Those Phase 3 IDs
are confirmed `DONE` in both `src/ts/__tests__/fixCompletenessGateV2.test.ts`
and [`active-risk-analysis.md`](active-risk-analysis.md). I16 intentionally
remained no-action. The focused runtime proofs, protocol-metrics prompt suite,
parser CBS suites, gates, root test suite, API suite, client-thinning audit,
and TypeScript checks passed.

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/lorebook.test.ts server/fastify/__tests__/scripts.test.ts server/fastify/__tests__/triggers.test.ts server/fastify/__tests__/templates.test.ts server/fastify/__tests__/promptVariables.test.ts`:
  passed, 7 files / 391 tests.
- `RISU_PROTOCOL_METRICS=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts`:
  passed, 1 file / 61 tests.
- `pnpm exec vitest run src/ts/parser/tests/cbs/eachReinjection.test.ts src/ts/parser/tests`:
  passed, 8 files; 84 passed / 4 skipped (88 total).
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 2 files / 26 tests. The live v2 gate expects H1-H3, Phase 2's M5,
  M6, L3, L13, L14, L16, K1, and K2, plus Phase 3's M1-M4 and L4-L11 as
  `DONE`.
- `pnpm test`: passed, 125 files; 1160 passed / 4 skipped (1164). The run
  printed the pre-existing repeated `ECONNREFUSED 127.0.0.1:3000`
  local-service probe noise but exited 0.
- `pnpm api:test`: passed, 99 files; 1792 passed / 1 skipped (1793). The run
  printed normal Fastify request logs and exited 0.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: passed with zero diagnostics.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: passed with zero
  diagnostics after the client-lib build.

Phase 3 focused proof summaries:

- M1: assemble tests assert no full-transcript clone/stringify capture for
  unchanged stages; trigger/editinput mutation stages still capture, and
  prompt bytes stay identical.
- M2/L8/L9: history/depth prompt paths reuse parser expansions and
  fixed-point rows; marker-free rows skip CBS parse and preflight/final reuse
  depth prompt bodies.
- M3: stable template card cache evaluates stable cards once per assembly,
  preflight tokenization reuses cached rows, and `{{setvar}}`-bearing stable
  cards evaluate once.
- M4: CBS callback memo reuses `{{charhistory}}`, `{{userhistory}}`, and
  `{{lorebook}}` callbacks within an assembly.
- L4/L5: sticky lorebook activation vars persist across sends; normalized
  search corpus data is reused.
- L6/L7: the no-trigger path avoids cloned trigger payloads; trigger
  regex/transcript work is memoized.
- L10/L11: `{{#each}}` expansion has deterministic budget caps, and matcher
  lookup normalizes registered names/aliases once while preserving raw tag
  text and normal output below the cap.

## Phase 7 Verification Refresh

Recorded on 2026-06-06 KST after M15, M16, M18-M22, L48-L59, and K3 landed.
Those Phase 7 IDs are confirmed `DONE` in both
`src/ts/__tests__/fixCompletenessGateV2.test.ts` and
[`active-risk-analysis.md`](active-risk-analysis.md). The v2 gate entries point
at real focused test paths and test names for each ID. The focused runtime
proofs, parent phase validation snippets, gates, root test suite, API suite,
client-thinning audit, and TypeScript checks passed.

- `pnpm exec vitest run src/ts/translator/translator.cache.test.ts src/ts/translator/translator.html.test.ts src/ts/translator/bergamotTranslator.test.ts`:
  passed, 3 files / 11 tests.
- `pnpm exec vitest run src/lib/ChatScreens/Suggestion.svelte.test.ts src/lib/ChatScreens/ChatBody.svelte.test.ts`:
  passed, 2 files / 5 tests.
- `pnpm exec vitest run src/ts/process/tts.test.ts src/ts/process/ttsHooks.test.ts`:
  passed, 2 files / 14 tests.
- `pnpm exec vitest run src/ts/process/mcp/mcplib.test.ts src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/internalClients.test.ts src/ts/process/mcp/googlesearchclient.test.ts`:
  passed, 4 files / 19 tests.
- `pnpm exec vitest run src/ts/process/processzip.test.ts src/ts/process/files/multisend.test.ts src/ts/process/files/tests/inlays.test.ts`:
  passed, 3 files / 35 tests.
- `pnpm exec vitest run src/ts/parser/tests/inlayBlobCache.test.ts src/ts/characterCards.pngImport.test.ts src/ts/characters.importChat.test.ts src/ts/storage/risuSave.test.ts`:
  passed, 4 files / 8 tests.
- Parent phase validation snippets:
  `pnpm exec vitest run src/ts/process/coldstorage.test.ts src/ts/process/ttsHooks.test.ts`
  passed, 2 files / 11 tests;
  `pnpm exec vitest run src/ts/characters.importChat.test.ts src/ts/storage/risuSave.test.ts`
  passed, 2 files / 2 tests.
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 2 files / 26 tests. The frozen v1 gate and live v2 gate are green;
  the live v2 gate expects Phase 7's M15, M16, M18-M22, L48-L59, and K3 as
  `DONE` alongside the earlier completed IDs.
- `pnpm test`: passed, 137 files; 1212 passed / 4 skipped (1216). The run
  printed the pre-existing repeated `ECONNREFUSED 127.0.0.1:3000`
  local-service probe noise but exited 0.
- `pnpm api:test`: passed, 99 files; 1792 passed / 1 skipped (1793). The run
  printed normal Fastify request logs and exited 0.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: passed with zero diagnostics.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: passed with zero
  diagnostics after the client-lib build.

Phase 7 focused proof summaries:

- M15/M16/L58/L59: the translate cache is bounded and LRU-evicted, repeated and
  concurrent lookups dedupe, chat switch clears the cache, streaming
  auto-translate work and HTML logs stay suppressed, suggestion translation
  commits are epoch/source guarded, and `markParsing` does not retry network
  translation failures through the full parse pipeline.
- M18/L48/M19: repeated TTS playback reuses one `AudioContext`, releases
  network and gain nodes, `stopTTS` clears stale refs, HuggingFace retries are
  capped with one translation pass, and bergamot recovers after rejected calls
  or simulated hard wasm failures while preserving serialized success order.
- M20/L54/L55/L56/L57: MCP request/handshake/SSE waits time out with listener
  cleanup, debug payload logs are gated off by default, internal tool schemas
  are mutation-safe, dispatch reuses the name-to-client index, duplicate-name
  winner order is preserved, and FileSystem client recreation reuses a valid
  stored directory handle.
- M21/M22/L49-L53/K3/L51: known and unknown-size oversized CharX assets are
  skipped or terminated without retaining partial bytes while valid imports
  stay byte-identical; `.po` files longer than 100 lines translate fully; file
  sends log nothing for `.po`, PDF, XML, and text; PDF parsing receives raw
  bytes; inlay image failures reject instead of hanging; blob URL caching is
  LRU bounded, revokes evicted URLs, checks the cache before fetching bytes,
  and renders cached/uncached inlays identically; PNG embedded assets are
  decoded/sliced once while preserving import output and progress order.

## Phase 0 Baseline Refresh

Recorded on 2026-06-05 after the v2 gate and render-count baseline landed:

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts`:
  passed, 2 files / 26 tests. The v2 gate is green alongside the frozen v1
  gate.
- `pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts`:
  passed, 1 file / 1 test. Fixed baseline `N=5`; observed/asserted
  `mountedMessages=5`, `parsesAfterBump.parseMarkdown=5`,
  `parsesAfterBump.risuChatParser=5`, `parsesAfterBump.editDisplay=5`,
  `editDisplayRunsAfterBump=5`, and `cacheWiped=true`.
- `pnpm test`: passed, 1152 passed / 4 skipped (125 files).
- `pnpm api:test`: passed, 1737 passed / 1 skipped (99 files).
- `pnpm client-thinning:audit`: passed.
- `pnpm exec tsc -p tsconfig.client-lib.json`: passed with zero diagnostics.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: passed with zero
  diagnostics after the client-lib build.

## Audit-Time Measurements

Recorded during the 2026-06-05 v2 audit (evidence in
[`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md)):

- M5 reference: a character PATCH on the 50-character / 6.85 MB reference DB
  costs ~73 ms of broad load + corpus repair, ~30 ms of it the duplicate
  `ensureCharacterCollection` pass.
- M2 reference: the marker-free history re-parse is a ~15-30 ms per-send tax
  on typical transcripts (<150 ms multi-MB worst case).
- H2/L13 scale with total corpus message volume (hydrate + clone + diff per
  chat-create / per Realm append).
- H3 cost is O(visible messages x full parse pipeline) per
  `ReloadGUIPointer` bump, cold (caches wiped by `resetScriptCache`).

## Reproducing Cost Checks

- Server stage timings: focused server tests with `RISU_PROTOCOL_METRICS=1`
  and `RISU_COMMAND_METRIC_SUMMARY=1`. Watch `databaseLoad*`,
  `projection_response`, and command metrics.
- Static corpus cost: `pnpm analyze:db <input>`.
- Client render cost: profile while firing a `/trigger` command or
  `{{v2UpdateGUI}}` effect; watch `ParseMarkdown`/`risuChatParser` self-time
  across visible messages. The Phase 0 render-count probe turns this into a
  countable gate signal.
- Client protocol logs: `localStorage.setItem('risu:protocol-debug','1')`.

## Run Log

- 2026-06-05, plan opened: baseline carried from the v1 close (`ea0dc34a`,
  `pnpm test` 1132/4, `pnpm api:test` 1737/1, audit green, TypeScript clean);
  both TypeScript checks re-run clean at v2 audit time. No runtime change.
- 2026-06-05, Phase 0 render-count baseline:
  `pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts` passed.
  Fixed `N=5` visible mounted messages; observed `mountedMessages=5`,
  `parsesAfterBump.parseMarkdown=5`, `parsesAfterBump.risuChatParser=5`,
  `parsesAfterBump.editDisplay=5`, `editDisplayRunsAfterBump=5`, and
  `cacheWiped=true`. This records the pre-fix H3/M17/L40 contract only; the
  full Phase 0 verification refresh is recorded below.
- 2026-06-05, Phase 0 verification refresh: full proof set passed. v2+v1
  gates passed (2 files / 26 tests); render-count baseline passed (1 file / 1
  test, `N=5` with all post-bump parse counts at 5 and caches wiped);
  `pnpm test` passed (1152/4, 125 files); `pnpm api:test` passed (1737/1, 99
  files); client-thinning audit passed; both TypeScript checks passed with the
  client-lib build run before the strict Fastify check.
- 2026-06-06, Phase 1 verification refresh: focused H2, H1, and H3 suites
  passed; v1+v2 gates passed with H1-H3 as `DONE`; `pnpm test`,
  `pnpm client-thinning:audit`, and both TypeScript checks passed. After the
  H2 chat-create ceiling expectation was refreshed, focused
  `server/fastify/__tests__/commandMessageFreeCeiling.test.ts` passed (9
  tests), the v2 gate passed (18 tests), and `pnpm api:test` passed (1744
  passed / 1 skipped, 99 files).
- 2026-06-06, Phase 2 verification refresh: focused Phase 2 suites passed
  (88 tests, 1 metrics test, 171 generation/message/Realm/auth tests);
  v1+v2 gates passed (26 tests); `pnpm test` passed (1155/4, 125 files);
  `pnpm api:test` passed (1765/1, 99 files); both TypeScript checks passed.
  After the A4R3 command-path id-minting blocker in
  `PATCH /api/v1/commands/characters/:characterId` was fixed,
  `pnpm client-thinning:audit` passed, the focused command/load-cost
  remediation suite passed (148 tests), the v2 gate passed (18 tests), and
  Phase 2 closed.
- 2026-06-06, Phase 3 verification refresh: focused assembly/CBS/trigger
  suites passed (391 tests); protocol-metrics generation chat passed (61
  tests); parser CBS suites passed (84 passed / 4 skipped); v1+v2 gates
  passed (26 tests) with M1-M4 and L4-L11 as `DONE`; `pnpm test` passed
  (1160/4, 125 files); `pnpm api:test` passed (1792/1, 99 files);
  client-thinning audit and both TypeScript checks passed. I16 remained
  no-action.
- 2026-06-06, Phase 7 verification refresh: focused translate/UI/TTS/MCP/
  file-import suites passed (11, 5, 14, 19, 35, and 8 tests respectively);
  parent phase validation snippets passed (11 and 2 tests); v1+v2 gates passed
  (26 tests) with M15, M16, M18-M22, L48-L59, and K3 as `DONE`; `pnpm test`
  passed (1212/4, 137 files); `pnpm api:test` passed (1792/1, 99 files);
  client-thinning audit and both TypeScript checks passed.
