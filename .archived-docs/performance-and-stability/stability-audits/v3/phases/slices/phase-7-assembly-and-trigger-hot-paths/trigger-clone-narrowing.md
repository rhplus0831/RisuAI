# Slice: Trigger Clone Narrowing

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Finding: L8.
Riding item: I5 if it is cheap while touching trigger budget plumbing.
Server trigger clone-count change.

## Scope

Narrow `runTrigger`'s full chat clone to trigger phases that can mutate
messages, while preserving per-phase transcript isolation for mutating trigger
sets.

This slice owns clone classification and clone timing inside server
`runTrigger`. It does not change trigger condition semantics, effect order,
Lua execution behavior, recursive trigger limits, manual/display trigger
behavior, or persistence of trigger mutations.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L8 and I5 context.
- `server/fastify/src/prompt/triggers.ts`: `runTrigger`, trigger set
  selection, the current `structuredClone` calls, recursive trigger calls,
  `evaluateConditions`, and `chargeTriggerEffectStep`.
- `server/fastify/src/prompt/assemble.ts`: input/start/output phase callers
  and the `luaExecBudget` shared per-send budget precedent.
- `server/fastify/src/prompt/history.ts`: start-trigger caller inside history
  window construction.
- Focused tests:
  `server/fastify/__tests__/triggers.test.ts`,
  `server/fastify/__tests__/assemble.test.ts`, and
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Classify the trigger set for the current phase before cloning the full chat.
  Trigger sets with no message-mutating effect kinds should avoid the full
  transcript clone or clone only the bounded rows they actually need.
- Keep classification conservative. If an effect can append, delete, replace,
  reorder, or otherwise mutate `chat.message`, that phase must still receive a
  private clone.
- Do not share one clone across input, start, and output phases. The phases
  legitimately see different transcripts, so narrowing must happen per phase.
- Preserve mutation isolation for mutating sets: caller-owned chat state must
  not change unless `runTrigger` returns a changed chat and the phase caller
  accepts it.
- Preserve display-mode behavior, where the existing no-clone path is part of
  the legacy contract.
- Add clone-count tests for all three server phases. The no-message-mutation
  case should clone no transcript; mutating cases should still clone and keep
  caller state isolated.
- If I5 lands as a riding change, thread one shared per-send JS trigger budget
  through phase callers in the same spirit as `luaExecBudget`. Keep it
  optically separate in tests so L8 can land without depending on I5.
- Register L8 as `DONE` in the v3 gate and flip only the L8 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change. If I5 lands, record it using the established
  informational-item convention.

## Invariants

- Trigger results, variable writes, resend flags, and persisted mutations stay
  output-identical.
- Mutating trigger effects still cannot mutate caller-owned transcripts by
  accident.
- Input, start, and output phases are verified independently.
- Recursive trigger calls keep their existing recursion and budget behavior.
- I5 is optional; L8 must not depend on a budget refactor to be correct.

## Done Criteria

- A trigger set with no message-mutating effects performs no full transcript
  clone in input, start, and output phases.
- A trigger set with message-mutating effects still receives a private clone
  and leaves caller state isolated until the phase accepts the result.
- Tests prove the three phases are not sharing a stale or cross-phase clone.
- Trigger output and mutation payloads remain byte-identical for representative
  mutating and non-mutating fixtures.
- L8 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
