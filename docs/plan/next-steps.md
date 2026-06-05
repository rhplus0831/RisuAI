# Next Steps

Date: 2026-06-05

ALL SCHEDULED PHASES ARE COMPLETE. Phase 1: H1 `0dc7452e`, H3 `e41dc6c6`, H2
`067ab82a`. Phase 2: scoped assembly load (M1, L1, L2, `c193c008`),
command-mutation read narrowing (M3, L5, L6, `e0e86ab1`), single-character
projection (M4, `254b3112`), and the metric/bulk-read slice (M5, L10, U1,
`b2765994`). Phase 3: client clone narrowing (M12-M14, L31-L36, U4) plus the
L32 watcher/global-modal ID-assignment follow-up. Phase 4: outbound request
lifecycle (M6, M8, L20, L22-L25, `bf1a6cb2`). Phase 5: materialization and
lifecycle cleanup (M9-M11, L11-L15, L27-L30, `686220d6`). Phase 6:
memory/Lua bounds and reuse (M7, L16-L19, L21, `ca798c01`). Phase 7:
memoization and hygiene (M2, L3, L8, L9, L37-L40, `151c6978`) — the last
scheduled batch. Phase 8 is closed: every exit criterion is met and the
closing full run (`pnpm test` 1132/4, `pnpm api:test` 1737/1, audit green,
both tsc checks zero errors) is recorded in
[`latest-verification.md`](latest-verification.md); the gate test stays live
as the standing maintenance check. The 57-finding audit is fully discharged:
every scheduled id is DONE with a regression test and a Phase 8 gate entry;
the only open ids are the gated owner-decision items (L4, L7, L26, U2 —
evidence-gated) and U3 (no action).

## Current Posture

There is no scheduled work left in this plan — all phases (0-8) are closed.
What remains is maintenance:

1. Keep the Phase 8 gate green: `fixCompletenessGate.test.ts` enforces that
   every DONE id keeps its regression test and that the registry stays in
   lockstep with [`active-risk-analysis.md`](active-risk-analysis.md).
2. If real-corpus evidence (via `RISU_PROTOCOL_METRICS=1`) or an owner
   decision promotes a gated item (L4, L7, L26, U2), schedule it the
   established way: slice doc -> fix + regression -> gate flip (registry +
   doc together) -> [`latest-verification.md`](latest-verification.md)
   refresh.
3. After any later change touching the narrowed/bounded paths, re-run the
   proof commands below and update the verification log.

## Done So Far (Phases 0-7 complete)

- M2, L3, L8, L9, L37-L40 — memoization & hygiene, DONE (`151c6978`, one
  batch): `processScript` prepares modules + script DSL + compiled RegExps
  once per assembly via a per-`Database` memo (cbs-action scripts keep
  per-message compiles; `getActiveModules` returns a stable empty constant
  so the memo can ref-key its result) (M2); the lorebook keyword search
  compiles each `/pattern/flags` key once via a bounded memo with
  `lastIndex` reset on retrieval (L3); the 9 trigger-effect `new RegExp`
  sites reuse `getCompiledRegex` — per-pass reuse, since a var-writing pass
  resets the cache at its end through `ReloadGUIPointer` (L40);
  `pruneCommandEventHistory` issues one keep-window range DELETE
  (`revision <= latest - limit`) instead of the per-write `OFFSET 999` walk
  (L8); character delete relies on the `chats.character_id ON DELETE
  CASCADE` with the cascaded write still recorded in `writtenTables`, and
  the unused `deleteCharacterChats` helper is gone (L9); the command
  pipe/preset/`Trigger time` logs are removed — the completion-audit
  closeout also removed `importPreset`'s four remaining object dumps, so
  `database.svelte.ts` has zero `console.log` calls (L37, L38); the terminal
  assistant lookup scans the transcript in place (L39). Regressions:
  `scripts.test.ts` M2 block, `lorebook.test.ts` L3 block, `events.test.ts`
  L8 test, `repositoryWriterKit.test.ts` L9 test,
  `command.projectionGuard.test.ts` L37 test +
  `database.importPreset.test.ts` preset-import no-log tests,
  `scripts.editdisplay.test.ts` (L38),
  `serverBackedSendChat.findMessage.test.ts` (L39),
  `triggers.regexMemo.test.ts` (L40).

- M7, L16-L19, L21 — memory & Lua, DONE (`ca798c01`, one batch): the
  embed/summarize batch handlers drain at most `MEMORY_JOB_BATCH_MAX_JOBS`
  (32) jobs per tick and the `voyageContext3` contextual request is sliced
  into token-aware sub-batches (~12k tokens at ~4 chars/token; oversized
  chunks travel alone; unresolvable jobs isolated), each executed and
  committed independently with a per-sub-batch `groupId` (M7);
  `cleanupOrphanedMemory` exits before the summary re-parse when the chat
  has no summaries and opens no `BEGIN IMMEDIATE` when nothing is orphaned
  (L16); the worker claims round-robin across pending chats via
  `listPendingMemoryJobChatIds` + an in-memory recency map, never-served
  chats FIFO (L17); the handlers' default loader is the memory-job-scoped
  `loadPersistedDatabaseForMemoryJob` — settings row + `hypa_v3_presets`
  table + id-only character/chat stubs, broad fallback for
  uninitialized/pre-extraction states (L18); `runServerLua` charges each
  run's wall clock against the per-assembly `LuaExecBudget` (30s default,
  threaded through every hook seam; constrained runs get
  `min(execTimeoutMs, remaining)`, exhaustion short-circuits before any
  engine boots) (L19); a pre-warmed engine pool runs the static prelude and
  declares the host-fn surface at warm-up (state bound per call), each call
  still gets one engine and closes it, and every boot serializes behind the
  shared boot gate while no run is in flight (L21). Regressions:
  `memoryEmbedJobHandler.test.ts`, `memorySummarizeJobHandler.test.ts`,
  `memoryRepository.test.ts`, `memoryWorker.test.ts`, `luaRuntime.test.ts`.

- M9-M11, L11-L15, L27-L30 — materialization & lifecycle, DONE
  (`686220d6`, one batch): streaming `boundedInflate.ts` cap enforcement,
  `collectMessageInlayReferences` column-only GC/report scan, bundle-export
  close/error settle + Zip/FD teardown, `armSseLiveDelivery` guard, done-job
  WS close, `trackRunner`/`settleRunners` before `db.close()`, durable
  viewer comment heartbeat, no-viewer overflow abort, corrupt-manifest skip,
  transactional legacy restore, schema v15 `origin_writer_session_id`
  replay, deferred reattach re-arm. Regressions:
  `risuSaveBoundedInflate.test.ts`, `risuSaveBundleImportRoute.test.ts`,
  `assetGc.test.ts`, `risuSaveBundleExportRoute.test.ts`, `events.test.ts`,
  `streamJobsRoutes.test.ts`, `durableGeneration.test.ts`,
  `streamJobs.test.ts`, `backups.test.ts`, `reattach.test.ts`.

- M6, M8, L20, L22-L25 — outbound request lifecycle, DONE (`bf1a6cb2`, one
  batch): proxy abort-on-close + 600s `requestTimeout` backstop, shared
  `attachAbort` 600s non-durable deadline + 32 MB buffered-body cap
  (`readBoundedBodyText/Json`), request/job signal through `AssembleDeps`
  into `runServerLua`, 8 MB streaming-buffer cap, `isBlockedV6`
  embedded-IPv4 unwrap, `setObjectValue` prototype-key guard,
  post-validation egress counting. Regressions: `proxy.test.ts`,
  `requestAbort.test.ts`, `generationBodyCap.test.ts`, `luaRuntime.test.ts`,
  `openai.test.ts`, `ollama.test.ts`, `additionalParams.test.ts`.

- M12-M14, L31-L36, U4 — client clone narrowing, DONE (`0efa7ba6` plus L32
  follow-up): `/setvar`/`/addvar` drop the redundant `setDatabase`
  normalizer (M12); `changedCharacterFields` diffs per kept key (M13);
  `setupSendChatContext` rolls back via one `currentCharacterRowSnapshot`
  (M14); scoped script-definition watcher (L31); scoped lorebook
  snapshots/ID assignment (L32); signal-read modules `$effect` (L33);
  chat-scoped module toggle (L34); single-row MCP patch (L35); runner
  rejection rollback (L36); chat-scoped `setCurrentChat` (U4). Regressions:
  `command.projectionGuard.test.ts`, `characterCommands.test.ts`,
  `sendChatContext.test.ts`, `scriptDefinitionBridge.svelte.test.ts`,
  `lorebookBridge.test.ts`, `lorebookBridge.svelte.test.ts`,
  `stores.modulesEffect.svelte.test.ts`, `moduleCommands.test.ts`,
  `characters.setCharacterInfo.test.ts`, `commands.test.ts`,
  `chatCommands.test.ts`.

- M5/L10/U1 — projection metric & bulk read, DONE (`b2765994`); M4 —
  single-character projection, DONE (`254b3112`); M3/L5/L6 —
  command-mutation read narrowing, DONE (`e0e86ab1`); M1/L1/L2 — scoped
  assembly load, DONE (`c193c008`). Regressions:
  `serverLoadCostHarness.test.ts`, `providerSecrets.test.ts`,
  `commandMutationReadNarrowing.test.ts`, `modulesMemo.test.ts`,
  `assemble.test.ts`.

- H1 — `loadChatHydration` guard, DONE (`0dc7452e`); H3 — streaming render
  coalescing, DONE (`e41dc6c6`); H2 — chat-selection scalar snapshot, DONE
  (`067ab82a`). Regressions: `serverLoadCostHarness.test.ts`,
  `streamResponse.test.ts` (+ coalescer unit suite),
  `globalApi.changeChatTo.test.ts` + `chatCommands.test.ts`.

## Not First

These remain the standing guardrails for any future work on these paths:

- Do not edit `loadPersistedWithMessages` itself as a hot-path shortcut — it is
  shared with full-corpus consumers that genuinely need all chats' messages.
  Add a path-specific scoped loader instead.
- Do not delete the full-collection client snapshot
  (`currentChatStateSnapshot`) or the broad SQLite loaders; create/delete/
  reorder/fork and the full-corpus consumers still need them.
- Do not change a narrowed rollback's restore set; it must restore exactly what
  the command mutates or it can clobber unrelated edits.
- Do not set an aggressive provider/proxy timeout; use a generous default (the
  durable path's 600s is the reference).
- Do not let a memory/Lua change alter memory selection output or the locked
  `/generate/chat` SSE vocabulary; budgets bound work, not results.
- Do not change `.risu` envelope bytes or projection/bootstrap payloads;
  narrowing changes what the server loads, not what it returns. Round-trip tests
  gate any codec/export change.
- Do not let a memoization change alter output bytes; the M2/L3/L40
  compile-count tests pin identity — keep them passing, and exclude
  per-message-variant inputs (cbs scripts) from any shared compile.
- Do not schedule the gated items (L4, L7, L26, U2) without real-corpus
  evidence or an owner decision.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
load/projection/guard behavior. Note: `pnpm api:test -- <file>` does NOT
filter — use `pnpm exec vitest run --config server/fastify/vitest.config.ts
<files>` for focused server runs.

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/projection.test.ts`
  (H1, M4, M5, U1, L10 — hydration/projection responses).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts`
  (M1, L1, L2 — assembly load; `RISU_PROTOCOL_METRICS=1` for stage timings).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/scripts.test.ts server/fastify/__tests__/lorebook.test.ts`
  (M2, L3 — per-assembly compile counts + output identity).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/repositoryWriterKit.test.ts server/fastify/__tests__/commandFloorUnblock.test.ts`
  (L8, L9 — prune keep-window; FK-cascade delete parity).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMetrics.test.ts`
  (M3, L5, L6 — command-mutation read cost; `RISU_COMMAND_METRIC_SUMMARY=1`).
- `pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts`
  (H2, M13, M14, L34, L35, U4 — client snapshot/rollback narrowing).
- `pnpm exec vitest run src/ts/process/triggers.regexMemo.test.ts src/ts/process/scripts.editdisplay.test.ts src/ts/process/serverBackedSendChat.findMessage.test.ts src/ts/process/__tests__/command.projectionGuard.test.ts`
  (L37-L40 — client hygiene + trigger regex memo).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/generation.test.ts`
  (M6, M8, L20, L22 — abort/timeout).
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts server/fastify/__tests__/memoryWorker.test.ts`
  (M7, L16, L17, L18 — memory batch/fairness/orphan).
- `pnpm test` (full client suite); `pnpm api:test` (full server suite).
- `pnpm client-thinning:audit` (optimistic-write / projection invariants).
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
