# Phase 6 Completion Audit

Date: 2026-06-05 (closeout applied same day — see the blocking finding's
resolution)

Scope: Active Phase 6 memory and Lua workstream in
`docs/plan/phases/phase-6-memory-and-lua.md`, covering M7, L16, L17, L18, L19,
L21, and the Phase 8 gate registration.

## Verdict

CLOSED. Phase 6 is complete.

The original audit verdict was "not fully complete yet": most Phase 6
implementation claims were present and the focused regression tests passed,
but in L21 the Lua engine pool only avoided *background* refills while Lua was
active — a foreground acquire could still fresh-boot an engine while another
run was active, contradicting the documented wasmoon safety constraint, with
no test covering that path. The blocking finding has since been closed; its
section below records the resolution.

## Blocking Finding

### L21: foreground Lua engine acquire can fresh-boot during an active run — CLOSED

`luaRuntime.ts` documents the wasmoon hazard:

- `server/fastify/src/prompt/luaRuntime.ts:1111` says engine boots mutate the
  shared wasm module function table.
- `server/fastify/src/prompt/luaRuntime.ts:1112` says booting while another
  engine has a pending Lua continuation can crash wasmoon.
- `server/fastify/src/prompt/luaRuntime.ts:1166` gates background pool refills
  with `activeLuaRuns > 0`.

That protection does not cover every boot path:

- `server/fastify/src/prompt/luaRuntime.ts:1191` waits for an in-flight refill
  and then tries to pop a pooled engine only for default-timeout runs.
- `server/fastify/src/prompt/luaRuntime.ts:1200` falls back to a fresh acquire
  and `createPreparedEngine(execTimeoutMs)` when the pool is empty or the run
  has a custom/budget-tightened timeout.
- `server/fastify/src/prompt/luaRuntime.ts:1301` calls `acquirePreparedEngine`
  before `activeLuaRuns++`, so the active-run guard is not held during acquire.

That leaves a plausible path where run A is already active and run B starts.
If run B cannot use a pooled default engine, it may boot a fresh engine while A
is still inside Lua. The current L21 tests prove sequential warm-pool service and
cross-run isolation, but not this concurrent fresh-boot path:

- `server/fastify/__tests__/luaRuntime.test.ts:560`
- `server/fastify/__tests__/luaRuntime.test.ts:591`

Recommended closeout: serialize fresh engine creation against active Lua runs
or move the active-run accounting/lock to include acquire. Add a regression that
keeps one Lua run suspended in an async host function or `:await()` continuation,
then starts another run that must fresh-boot because the pool is empty or the
timeout is custom. The test should prove no overlapping boot occurs and the run
does not crash.

Resolution (2026-06-05): implemented as recommended — both halves.

- All engine boots now serialize behind one shared gate: `luaEnginePoolFill`
  became `luaEngineBootGate`, held by the background refill *and* by a run's
  fresh boot. `acquirePreparedEngine` re-evaluates in a loop: it awaits any
  in-flight boot, pops a pooled engine when the run uses the default limit,
  and otherwise parks on `waitForLuaRunsDrained()` until `activeLuaRuns`
  reaches zero before claiming the gate and booting fresh.
- The active-run accounting moved into the acquire itself: `activeLuaRuns++`
  happens in the same tick as the pooled pop (or before the boot gate lifts on
  the fresh path), so there is no window between acquire and run start in
  which a parked booter could observe an idle world and boot alongside a
  starting run. `runServerLua`'s `finally` wakes parked booters
  (`notifyLuaRunsDrained`) before kicking the idle refill.
- Regression added: `luaRuntime.test.ts` "L21: a fresh boot never overlaps an
  active run with a pending Lua continuation" — run A suspends inside an
  in-flight `request():await()` continuation (controllable `fetchImpl`), run B
  uses a custom exec limit so it must fresh-boot, and the test proves no
  engine boot occurs and B does not settle while A is suspended, then proves
  strict A-before-B settle order and B's correct output after A drains.
  Verified to fail against the pre-fix runtime at exactly the
  boot-overlap assertion (`engineBoots` 1→2 while A was suspended). The Phase
  8 gate's L21 entry names it via `extraTests`.

## Satisfied Items

### M7: bounded memory batches and contextual embed sub-batches

Implemented.

- `server/fastify/src/memoryWorker.ts:23` defines
  `MEMORY_JOB_BATCH_MAX_JOBS = 32`.
- `server/fastify/src/memoryEmbedJobHandler.ts:97` drains at most that many
  embed jobs per batch.
- `server/fastify/src/memorySummarizeJobHandler.ts:87` drains at most that many
  summarize jobs per batch.
- `server/fastify/src/memoryEmbedJobHandler.ts:279` plans contextual
  `voyageContext3` sub-batches by approximate token size.
- `server/fastify/src/memoryEmbedJobHandler.ts:116` executes and commits each
  contextual sub-batch independently.

Coverage note: M7 gate coverage is uneven. The Phase 8 entry names embed
handler tests for the cap, contextual split, and independent commit, but it does
not name a summarize-specific cap test even though the Phase 6 claim covers both
embed and summarize draining.

### L16: orphan cleanup skips empty writes

Implemented.

- `server/fastify/src/memoryRepository.ts:606` uses an id-only `EXISTS` probe to
  skip summary metadata parsing when a chat has no summaries.
- `server/fastify/src/memoryRepository.ts:625` returns before
  `BEGIN IMMEDIATE` when summaries exist but none are orphaned.
- `server/fastify/__tests__/memoryRepository.test.ts:448` covers the
  no-summary fast path.
- `server/fastify/__tests__/memoryRepository.test.ts:480` covers the
  summaries-exist/no-orphan/no-transaction path.

Scope note: this is proven at the repository function. Assembly currently calls
`cleanupOrphanedMemory` only when current chat memos are present, so the
repository fast path is available but is not an end-to-end assembly test for an
empty-memo chat.

### L17: fair per-chat memory job claims

Implemented.

- `server/fastify/src/memoryRepository.ts:845` lists pending chat IDs with an
  id-only aggregate query.
- `server/fastify/src/memoryWorker.ts:146` chooses the least-recently-served
  pending chat, preserving FIFO order for never-served chats.
- `server/fastify/src/memoryWorker.ts:177` processes one fair batch per tick.
- `server/fastify/__tests__/memoryWorker.test.ts:217` covers A/B round-robin
  serving.
- `server/fastify/__tests__/memoryWorker.test.ts:248` covers bounded-batch
  handoff to another chat.

### L18: scoped memory-job loader

Implemented.

- `server/fastify/src/memoryEmbedJobHandler.ts:525` uses
  `loadPersistedDatabaseForMemoryJob` by default when `dataDir` is present.
- `server/fastify/src/memorySummarizeJobHandler.ts:344` does the same for
  summarize batches.
- `server/fastify/src/repository.ts:1047` loads only settings-level fields,
  `hypa_v3_presets`, and id-only character/chat stubs, with broad fallback for
  uninitialized or pre-extraction states.
- `server/fastify/__tests__/memoryEmbedJobHandler.test.ts:660` proves the embed
  batch performs zero whole-corpus payload reads.
- `server/fastify/__tests__/memorySummarizeJobHandler.test.ts:522` proves the
  summarize batch performs zero whole-corpus payload reads.
- `server/fastify/__tests__/memorySummarizeJobHandler.test.ts:570` proves the
  scoped loader preserves the unknown-chat error path.

### L19: aggregate Lua execution budget

Implemented.

- `server/fastify/src/prompt/luaRuntime.ts:103` defines `createLuaExecBudget`.
- `server/fastify/src/prompt/luaRuntime.ts:1271` short-circuits exhausted
  budgets before acquiring an engine.
- `server/fastify/src/prompt/luaRuntime.ts:1286` clamps each run to the
  remaining budget.
- `server/fastify/src/prompt/luaRuntime.ts:1393` charges wall-clock time in
  `finally`.
- `server/fastify/src/prompt/assemble.ts:464` creates one budget per assembly
  state.
- `server/fastify/src/prompt/assemble.ts:632`,
  `server/fastify/src/prompt/assemble.ts:1300`, and
  `server/fastify/src/prompt/assemble.ts:1654` thread that budget through input
  triggers, edit hooks, and output triggers.
- `server/fastify/__tests__/luaRuntime.test.ts:505` covers exhausted-budget
  short-circuit.
- `server/fastify/__tests__/luaRuntime.test.ts:524` covers runaway trigger-loop
  bounding.

Coverage note: the implementation is threaded through assembly and
post-generation state reuse, but current L19 tests prove the runtime and trigger
loop directly rather than a full assembly plus post-generation sequence.

### L21: pooled prelude and per-call isolation

Implemented (the fresh-boot concurrency gap above is closed; see its
resolution).

- `createPreparedEngine` boots a prepared engine, declares host functions, and
  pre-runs the static prelude.
- `acquirePreparedEngine` serves pooled engines to default-timeout runs,
  serializes every fresh boot against active runs and other boots, and counts
  the run active atomically with the engine claim.
- `runServerLua`'s `finally` closes each engine after one call, preserving
  per-call isolation.
- `server/fastify/__tests__/luaRuntime.test.ts` proves: a default-limit run is
  served from the warm pool with output identical to a fresh run; Lua globals
  do not leak between pooled runs; a fresh boot never overlaps an active run
  with a pending Lua continuation.

## Phase 8 Gate Registration

Registered, with the coverage weaknesses noted above.

- `src/ts/__tests__/fixCompletenessGate.test.ts:127` registers M7 as `DONE`
  with embed handler proofs.
- `src/ts/__tests__/fixCompletenessGate.test.ts:312` registers L16 as `DONE`.
- `src/ts/__tests__/fixCompletenessGate.test.ts:326` registers L17 as `DONE`.
- `src/ts/__tests__/fixCompletenessGate.test.ts:341` registers L18 as `DONE`.
- `src/ts/__tests__/fixCompletenessGate.test.ts:360` registers L19 as `DONE`.
- `src/ts/__tests__/fixCompletenessGate.test.ts:390` registers L21 as `DONE`.

Gate limitation: `collectGateProblems` checks that registered files exist and
that registered test-name strings are present. That prevents silent test
renames/removals, but it is not a semantic proof that the assertions still cover
the intended behavior.

## Validation Performed

- `pnpm exec vitest run --config server/fastify/vitest.config.ts
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts
  server/fastify/__tests__/memoryRepository.test.ts
  server/fastify/__tests__/memoryWorker.test.ts`

  Result: 4 test files passed, 64 tests passed.

- `pnpm exec vitest run --config server/fastify/vitest.config.ts
  server/fastify/__tests__/luaRuntime.test.ts`

  Result: 1 test file passed, 27 tests passed.

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts`

  Result: 1 test file passed, 8 tests passed.

- `pnpm exec tsc -p tsconfig.client-lib.json` and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`

  Result: zero errors.

Note: the documented `pnpm api:test -- ...` and `pnpm test -- ...` forms
broadened to unrelated test files in this local run, so the focused audit used
direct `pnpm exec vitest run ...` invocations for clean file filters.

## Closeout Validation (2026-06-05)

- `pnpm exec vitest run --config server/fastify/vitest.config.ts
  server/fastify/__tests__/luaRuntime.test.ts`

  Result: 1 test file passed, 28 tests passed (27 prior + the new L21
  fresh-boot serialization regression).

- The new regression run against the pre-fix `luaRuntime.ts` (fix stashed):
  fails at the boot-overlap assertion (`engineBoots` expected 1, got 2 while
  run A held a pending continuation), proving it covers the audited gap.

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts`

  Result: 1 test file passed, 8 tests passed (L21 entry now names the new
  regression in `extraTests`).

- `pnpm exec tsc -p tsconfig.client-lib.json` and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`

  Result: zero errors.
