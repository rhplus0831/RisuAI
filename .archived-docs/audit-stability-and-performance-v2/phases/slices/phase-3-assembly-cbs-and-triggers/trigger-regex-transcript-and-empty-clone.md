# Slice: Trigger Regex Transcript And Empty Clone

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Findings: L6, L7.
Runtime change.

## Scope

Remove avoidable trigger work: do the no-trigger early return before deep
cloning the character/chat, memoize resolved trigger regexes within a run, and
reuse joined recent-transcript strings for trigger conditions and V2 safe data
effects.

This slice does not own the Phase 1 trigger budget/abort safety work or broad
trigger semantics. Normal trigger output should remain byte-identical.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L6 and L7.
- `server/fastify/src/prompt/triggers.ts`: `collectTriggers`,
  `evaluateConditions`, `runTrigger`.
- `server/fastify/src/prompt/triggerDataEffects.ts`: `v2SplitString`,
  `v2ReplaceString`, `v2RegexTest`, `v2QuickSearchChat`.
- Existing focused tests:
  `server/fastify/__tests__/triggers.test.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`.

## Target Shape

- Add a cheap trigger-presence path before `runTrigger` deep-clones the
  character and chat. It may collect or inspect triggers from the original
  character/modules, but it must preserve the existing no-trigger `null`
  result.
- Keep the existing behavior when triggers exist but none match the requested
  mode: return a non-null result shape, not `null`.
- Introduce a per-run trigger evaluation cache for recent transcript joins.
  Key by chat message array identity or run generation plus depth. Store the
  joined raw text, lowercased text, and strict word set only when each mode is
  needed.
- Use that transcript cache from `evaluateConditions` `exists` conditions and
  `v2QuickSearchChat`. Recompute or invalidate if an effect mutates
  `chat.message`.
- Add a bounded per-run regex cache for resolved pattern/flag pairs used by
  `exists` regex, `v2RegexTest`, `v2ReplaceString`, and regex delimiter
  splitting. Reset `lastIndex` before every use so global/sticky regexes behave
  like freshly compiled instances.
- Keep malformed regex behavior identical: the same condition/effect should
  fail closed or return the same fallback value as before.
- Add counting tests proving no-trigger runs do not structured-clone the
  character, repeated `exists`/quick-search checks reuse transcript joins, and
  repeated regex effects reuse compiled regexes.
- Register L6 and L7 as `DONE` in the v2 gate with focused tests, and flip
  their rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Display-mode trigger calls still use caller-owned char/chat references.
- Non-display trigger calls with at least one trigger still avoid mutating the
  input character and chat.
- Low-level access, recursive trigger behavior, V2 loop control flow, and
  request/display allowlists remain unchanged.
- Transcript caches must invalidate after impersonate, cutchat, modifychat, or
  any V2 effect that changes `chat.message`.

## Done Criteria

- No-trigger `runTrigger` returns `null` without deep-cloning the character.
- Repeated trigger `exists` and `v2QuickSearchChat` checks reuse transcript
  joins within a run.
- Repeated regex conditions/effects reuse compiled regexes within a run.
- Existing trigger behavior tests remain green.
- The v2 gate and active-risk rows mark L6 and L7 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
