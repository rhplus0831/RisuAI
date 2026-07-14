# Slice: Trigger Interpreter Budget And Abort

Phase: [1](../../phase-1-high-severity-hot-paths.md). Finding: H1. Planned
after [`chat-create-targeted-writer-kit.md`](chat-create-targeted-writer-kit.md)
and [`var-only-gui-reload-narrowing.md`](var-only-gui-reload-narrowing.md).
Runtime change.

## Scope

Make the server V2 trigger interpreter bounded and abortable. A malformed
`v2Loop`, huge `v2LoopNTimes`, or low-level self-recursive trigger must return
within the configured budget instead of hanging the request. Budget exhaustion
or abort should degrade to a logged early return from trigger execution, not a
route crash.

This slice is server-only. It does not rewrite the browser trigger interpreter
or change Lua runtime semantics beyond using `LuaExecBudget` as the budgeting
precedent.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  H1.
- `server/fastify/src/prompt/triggers.ts`: `TriggerRunContext`, `runTrigger`,
  recursive `runtrigger`/`v2RunTrigger`, `v2EndIndent`, `loopTimes`,
  `v2Loop`, and `v2LoopNTimes`.
- `server/fastify/src/prompt/assemble.ts`: input/output trigger contexts and
  `state.signal`.
- `server/fastify/src/prompt/history.ts` and
  `server/fastify/src/prompt/variables.ts`: `runStartTrigger` handoff through
  `ExpandContext`.
- `server/fastify/src/prompt/luaRuntime.ts`: `LuaExecBudget`, abortable waits,
  and host-function abort checks as the local pattern.
- `server/fastify/__tests__/triggers.test.ts` for normal trigger parity and new
  bounded-run regressions.

## Target Shape

- Add `signal?: AbortSignal` to `TriggerRunContext` and thread the originating
  `state.signal` through input, output, and start-trigger contexts. If
  `runStartTrigger` only receives `ExpandContext`, extend that context to carry
  the signal from assembly.
- Add a shared trigger execution budget to `runTrigger`, similar in spirit to
  `LuaExecBudget`. The budget should be shared across recursive trigger calls
  so recursion cannot reset the clock or iteration count.
- Check `ctx.signal?.aborted` before entering the effect loop, after awaited
  work, and at every `v2EndIndent` loop-back. Any sleep/yield used by the
  interpreter should wake or return promptly on abort.
- Add a hard total-iteration ceiling for loop back-edges driven by `v2EndIndent`
  so an infinite `v2Loop` and an enormous `v2LoopNTimes` both stop.
- Keep recursion bounded even when `trigger.lowLevelAccess` is true, either
  with a hard recursion depth or by charging the same shared budget in a way
  that low-level cards cannot bypass.
- Log budget exhaustion/abort at a low-noise diagnostic level and return the
  safest existing trigger result shape for completed work. Do not throw a new
  uncaught error through `/generate/chat`.
- Add focused H1 tests for:
  a never-breaking `v2Loop`,
  a huge `v2LoopNTimes`,
  a low-level self-recursive trigger, and
  a signal that aborts during a running trigger pass.
- Register H1 as `DONE` in the v2 gate with the bounded-run tests, and flip the
  H1 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Normal trigger suites should remain byte-identical for completed runs.
- `lowLevelAccess` should still control privileged effects; it must not remove
  the recursion/budget cap.
- Budget checks must be deterministic in tests. Prefer injectable or
  context-owned test budgets over assertions that depend on slow wall-clock
  timing.
- Lua's existing timeout and abort behavior should not regress.
- A client disconnect/cancel must stop trigger work promptly enough that the
  request cannot keep a CPU-bound pass alive indefinitely.

## Done Criteria

- Focused tests prove the three pathological trigger shapes terminate within
  budget and do not crash the route.
- Abort propagation tests prove a request signal reaches the V2 trigger loop
  and interrupts a running pass.
- Existing trigger and Lua runtime tests remain green.
- The H1 v2 gate entry points at real tests and the risk-map row is `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/luaRuntime.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
