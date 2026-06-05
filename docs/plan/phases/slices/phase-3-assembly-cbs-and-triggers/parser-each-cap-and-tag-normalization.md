# Slice: Parser Each Cap And Tag Normalization

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Findings: L10, L11.
May include I16 if the parser stack is already being touched. Runtime change.

## Scope

Bound pathological `{{#each}}` expansion and make per-tag matcher
normalization cheaper in the shared CBS parser. If the implementation touches
the parser nesting stack, fold in the I16 safety fix as a small companion
change.

This slice is shared client/server parser work. It should keep normal parser
output byte-identical and introduce a new failure mode only for pathological
inputs that exceed the documented `{{#each}}` budget.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L10, L11, and optional I16.
- `src/ts/parser/risuChatParser.ts`: `matcher`, `blockStartMatcher`,
  `blockEndMatcher`, `{{#each}}` expansion, nesting stacks.
- `src/ts/parser/risuChatParserHelpers.ts`: `parseArray` and block helpers.
- `src/ts/cbs.ts`: registered matcher names and aliases.
- Existing focused tests:
  `src/ts/parser/tests/cbs/eachReinjection.test.ts`,
  `server/fastify/__tests__/promptVariables.test.ts`,
  parser/CBS tests under `src/ts/parser/tests`.

## Target Shape

- Add an explicit parser budget for `{{#each}}` expansion. The budget should
  bound at least element count and expanded output size, with constants high
  enough for realistic prompt templates and low enough to stop accidental
  multi-MB or exponential expansions.
- Make budget exhaustion deterministic and documented. Acceptable shapes are a
  dedicated parser-budget error or a clearly tested failure return, but normal
  inputs must keep the exact old output bytes.
- Avoid materializing unnecessary intermediate full-body arrays when expanding
  `{{#each}}`. Preserve the landed prefix-drop reinjection behavior from the
  existing tests.
- Replace `matcher`'s per-tag `split` array allocation,
  `toLocaleLowerCase`, and regex cleanup with cheap parsing:
  find the first `:`/`::` separator, normalize the candidate function name with
  ASCII lowercase and separator skipping, and allocate the args array only when
  a registered callback exists.
- Normalize registered matcher names and aliases once at registration so lookup
  semantics remain unchanged for whitespace, `_`, `-`, and case variants.
- Preserve the original raw tag string `p1` passed to callbacks.
- If included, replace the fixed `Uint8Array(512)` nesting stack with a
  dynamically sized stack plus a clear maximum nesting budget, and remove the
  dead `commentV` twin stack. Keep existing valid nested-parser output
  identical below the cap.
- Add parser tests for normal `{{#each}}`, nested `{{#each}}`, budget
  exhaustion, matcher aliases/case/separators, and optional deep nesting.
- Register L10 and L11 as `DONE` in the v2 gate with focused tests. If I16 is
  included, register it in the no-action/optional evidence area the v2 gate
  expects. Flip the L10 and L11 rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Existing CBS callback behavior and callback argument arrays remain identical
  for normal inputs.
- Existing `{{#each}}` reinjection tests remain green.
- Parser output remains identical below the new cap.
- The new cap is the only intended parser-visible behavior change.
- Server prompt assembly should surface parser-budget failures consistently
  with the chosen parser error shape.

## Done Criteria

- Large pathological `{{#each}}` inputs stop at the documented budget.
- Normal and nested `{{#each}}` fixtures remain byte-identical.
- Matcher normalization avoids per-tag split/locale/regex work and keeps alias
  semantics intact.
- The v2 gate and active-risk rows mark L10 and L11 `DONE`.

## Validation

```bash
pnpm exec vitest run \
  src/ts/parser/tests/cbs/eachReinjection.test.ts \
  src/ts/parser/tests
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/promptVariables.test.ts \
  server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
