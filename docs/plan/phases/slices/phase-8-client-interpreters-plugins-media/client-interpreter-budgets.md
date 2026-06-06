# Slice: Client Interpreter Budgets

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Findings:
L38, L39, L40, and L41. Client runtime correctness and boundedness change.

## Scope

Port the server trigger and Lua execution budget shapes to the live client
interpreter entrypoints, and make client Lua engine reuse and editDisplay
cleanup bounded.

This slice owns the client `runTrigger` path, the client Lua runtime creation
and cache key, and editDisplay access-key cleanup. It does not change server
prompt assembly, server trigger execution, provider dispatch, or output-trigger
behavior that is no longer live in the Fastify send path.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L38, L39, L40, and L41.
- `src/ts/process/triggers.ts`: client `runTrigger`, manual trigger entry,
  recursive `runtrigger` / `v2RunTrigger`, `v2EndIndent`, loop handling, and
  trigger-button callers.
- `src/ts/process/scriptings.ts`: client Lua engine creation/cache,
  `runScript`, editDisplay Lua paths, `ScriptingEditDisplayIds`, safe and
  low-level access-key cleanup.
- Server precedents:
  `server/fastify/src/prompt/triggers.ts` (`TriggerExecutionBudget`) and
  `server/fastify/src/prompt/luaRuntime.ts` (instruction hook, wall-clock
  deadline, abort checks).
- Focused test homes: add or extend client trigger and scripting tests near
  `src/ts/process/triggers*.test.ts` and `src/ts/process/scriptings*.test.ts`.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  L38-L41 proof registration.

## Target Shape

- Add a shared client trigger execution budget modeled on the server
  `TriggerExecutionBudget`. The budget should be shared through recursive
  trigger calls so recursion, `v2Loop`, and huge `v2LoopNTimes` cannot reset
  the cap.
- Thread an `AbortSignal` from the live manual entrypoints: the `/trigger`
  command path and in-message trigger buttons. Cancel must be observed while a
  manual trigger is running.
- Check budget and abort before entering a trigger pass, after awaited work,
  and at loop-back edges. Budget exhaustion should surface a clear trigger
  error or early-return shape instead of freezing the tab.
- Install a wasmoon instruction-count hook and wall-clock deadline on client
  Lua engines, mirroring the server `luaRuntime` behavior closely enough that
  `while true do end` throws into the existing catch path.
- Make Lua budget defaults explicit and testable. Prefer injectable clock or
  budget knobs for deterministic tests over timing-only assertions.
- Key the client Lua engine cache by `(mode, codeHash)` or a small per-mode
  LRU keyed by code hash, so alternating distinct Lua bodies do not repeatedly
  tear down and rebuild the same mode-only engine.
- Delete the editDisplay access key in a `finally` tail alongside the existing
  Safe and LowLevel cleanup. Rejections from Python or Lua editDisplay runs
  must not skip cleanup.
- Register L38, L39, L40, and L41 as `DONE` in the v3 gate and flip only
  those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Completed valid trigger runs keep their existing visible effects and result
  shape.
- Low-level access continues to control privileged effects; it must not bypass
  trigger recursion or loop budgets.
- Lua host functions, safe/low-level access rules, and normal Lua output stay
  compatible with existing client scripting behavior.
- Warm engine reuse must never run stale code for a different trigger body.
- Every access-key add has a paired removal even when execution rejects.

## Done Criteria

- A manual trigger containing a never-breaking `v2Loop` terminates within the
  budget with a surfaced error or bounded early-return result.
- Cancelling a running manual trigger aborts the trigger promptly.
- A client Lua body containing `while true do end` terminates through the Lua
  budget path instead of freezing the tab.
- Alternating two distinct Lua trigger bodies with the same mode reuses warm
  engines by code hash instead of thrashing one mode-only cache entry.
- `ScriptingEditDisplayIds` stays bounded across successful and rejected
  editDisplay runs.
- L38-L41 are registered as `DONE` in the v3 gate and active-risk table, with
  no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/triggers.clientBudget.test.ts \
  src/ts/process/triggers.regexMemo.test.ts \
  src/ts/process/triggers.cloneCost.test.ts \
  src/ts/process/scriptings.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
