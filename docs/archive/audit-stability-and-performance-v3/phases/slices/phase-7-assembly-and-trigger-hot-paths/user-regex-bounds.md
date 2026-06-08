# Slice: User Regex Bounds

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Finding: L9.
v4 amendment: v4-L7. Server trigger and imported-regex safety/hot-path
boundedness change.

## Scope

Bound user-supplied regular expression work in the server trigger
interpreter and imported server assembly paths so one pathological pattern
cannot wedge the event loop inside a single synchronous RegExp operation.

This slice owns the server trigger data-effect helpers that compile or execute
user regexes, plus imported lorebook `useRegex` keys and customscript `in`
patterns used by server prompt assembly. It does not change client-side
trigger execution, Lua budgets, trigger step accounting outside regex
effects, lorebook activation semantics, customscript ordering, or legitimate
regex results below the selected caps.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L9.
- [`../../../../../audit-stability-and-performance-v4.md`](../../../../../audit-stability-and-performance-v4.md)
  v4-L7.
- `server/fastify/src/prompt/triggerDataEffects.ts`: `v2ExtractRegex`,
  `v2RegexTest`, `v2ReplaceString`, `v2QuickSearchChat`, and any shared regex
  compile/test helpers introduced for them.
- `server/fastify/src/prompt/triggers.ts`: `evaluateConditions`,
  `chargeTriggerEffectStep`, the display/request safe subset, and trigger
  error propagation.
- `server/fastify/src/prompt/lorebook.ts`: `getCompiledLoreKeyRegex`,
  `searchMatch`, imported-card `useRegex` keyword evaluation, and activation
  error/report behavior.
- `server/fastify/src/prompt/scripts.ts`: `prepareOne`, per-message
  `script.in` expansion for `cbs` scripts, and edit-output test/replace
  execution.
- `server/fastify/__tests__/triggers.test.ts`: trigger interpreter coverage
  to extend with bounded regex behavior.
- `server/fastify/__tests__/lorebook.test.ts` and
  `server/fastify/__tests__/assemble.test.ts`: imported lorebook/module
  customscript regex coverage to extend with bounded regex behavior.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for L9 proof
  registration once Phase 0 has authored the v3 gate.

## Target Shape

- Route every user-supplied regex compilation/execution in server trigger data
  effects, lorebook regex-key lookup, and server customscript `script.in`
  evaluation through one bounded helper, including condition-time regex
  checks and data-effect arms.
- Add explicit caps for pattern length and haystack length. Include replacement
  input length where a regex replacement can do unbounded work over a large
  string.
- Add a conservative complexity screen for known catastrophic shapes, such as
  nested unbounded quantifiers. If the chosen implementation cannot reliably
  screen complexity, document the non-interruptibility of one synchronous
  RegExp operation and make the length caps strict enough for the test fixture.
- Surface a clear trigger error when a regex exceeds caps or fails the
  complexity screen. The error should identify the regex bound, not fail later
  as an unrelated provider or assembly error.
- Surface a clear assembly/lorebook/customscript error for v4-L7 paths. If a
  path historically deactivated a malformed regex instead of throwing, keep
  that malformed-regex behavior but still reject unsafe patterns before
  executing them.
- Keep valid regex behavior unchanged below the caps: flags, captures,
  extraction results, replacements, quick-search hits, and condition truth
  values should match the old implementation. Lorebook activation reports and
  customscript output must also match for valid imported regexes.
- Add a catastrophic-backtracking regression that terminates within the bound.
  Avoid timing-only proof where possible by asserting the complexity screen or
  length cap rejects before executing the regex.
- Add imported-regex regressions for a lorebook `useRegex` key and a
  character/module customscript `in` pattern. The pathological fixture should
  fail fast before provider dispatch; the valid fixture should preserve the
  prompt/model output path exactly.
- Add one real generate-route proof using post-import-shaped lorebook or
  customscript data and a server-routable fake provider/model. The unsafe
  regex should surface a bounded-regex error before dispatch, the provider spy
  should see zero calls, and no assistant row or generation result should be
  persisted.
- Register L9 as `DONE` in the v3 gate and flip only the L9 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Legitimate regexes under the caps produce identical trigger results.
- Rejected regexes fail fast with a visible trigger error.
- Imported lorebook and customscript regexes use the same bounds as trigger
  regexes; no imported card path gets an unbounded private RegExp escape.
- The wall-clock trigger budget remains a between-effects guard; this slice
  does not pretend it can interrupt an already-running JS RegExp.
- `v2RegexTest` and `v2ExtractRegex` remain available to the same safe-subset
  trigger modes, but bounded.
- Client trigger regex behavior is out of scope for this server slice.

## Done Criteria

- A catastrophic-backtracking pattern is rejected or bounded before it can hang
  the event loop.
- Pattern, haystack, and replacement caps are covered by focused tests.
- Imported lorebook `useRegex` and customscript `script.in` paths are covered
  by focused regex-bound tests, including an imported card/module fixture that
  would otherwise block before provider dispatch.
- A route-level imported-regex fixture proves unsafe lorebook/customscript
  regexes stop before provider/model dispatch and do not persist generation
  output.
- Representative valid `v2RegexTest`, `v2ExtractRegex`, `v2ReplaceString`,
  and `v2QuickSearchChat` cases remain output-identical.
- Representative valid lorebook and customscript regex cases remain
  output-identical.
- L9 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Implementation Proof

- Shared helper: `server/fastify/src/prompt/boundedRegex.ts` enforces pattern,
  haystack, and replacement caps and rejects nested unbounded quantifier shapes
  before execution. One JavaScript `RegExp` call remains synchronous and
  non-interruptible once started; this slice protects the server by screening
  and capping before `test`, `split`, `match`, `matchAll`, or `replace`.
- v3 L9 trigger proof: `server/fastify/__tests__/triggers.test.ts` covers valid
  V2 regex behavior, pattern/haystack/replacement caps, catastrophic-shape
  rejection, and condition-time regex rejection.
- v4-L7 imported-regex proof: `server/fastify/__tests__/lorebook.test.ts`,
  `server/fastify/__tests__/assemble.test.ts`, and
  `server/fastify/__tests__/generation.chat.test.ts` cover imported lorebook
  `useRegex`, customscript `script.in`, and route-level no-dispatch/no-assistant
  persistence. v4-L7 rides this L9 implementation and does not add a separate
  v3 active-risk row.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
