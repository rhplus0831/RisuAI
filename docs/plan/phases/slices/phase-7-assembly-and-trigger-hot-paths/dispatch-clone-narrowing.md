# Slice: Dispatch Clone Narrowing

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Findings:
L3 and K3. Server prompt dispatch/restoration clone-count change.

## Scope

Remove full prompt/transcript clones that are provably unnecessary on the
default send path: the dispatch-layer `reformatMessages` clone when no
reformat branch applies, and the restoration payload clone of immutable
`initialMessages`.

This slice owns `reformatMessages` and the restoration-message payload path.
It does not change prompt assembly, provider adapter wire payloads, OpenAI
message normalization semantics, transcript mutation capture, or scriptstate
restoration cloning.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L3 and the K3 known-overlap residual.
- `server/fastify/src/prompt/chatDispatch.ts`: `reformatMessages`,
  provider flag calculation, and the `buildPayload` dispatch call.
- `server/fastify/src/generation/openai.ts`: payload consumer expectations.
- `server/fastify/src/prompt/assemble.ts`: `beginAssembly`,
  `initialMessages`, `buildRestorationPayload`, and `cloneMessages`.
- Focused tests:
  `server/fastify/__tests__/assemble.test.ts` and
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Compute whether any reformat branch applies before cloning dispatch rows.
  If no branch applies, return `rows` unchanged by reference.
- If a branch does apply, clone lazily at the branch boundary and preserve the
  old branch-specific output exactly. Do not mutate caller-owned rows in place
  unless that branch has already made its private clone.
- Add output-identity coverage for default-provider sends and for every
  reformat branch that still clones. A freeze test or identity assertion
  should prove the no-branch path does not mutate input rows.
- Return `state.initialMessages` by reference in the restoration payload.
  `initialMessages` is set once in `beginAssembly` and treated as immutable;
  keep cloning `initialScriptstate` because the scriptstate object is mutable.
- Add a count probe proving a default-provider send performs zero
  dispatch-layer prompt clones and zero restoration-message clones.
- Register L3 and K3 as `DONE` in the v3 gate and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Provider payload bytes remain identical for every flag combination.
- The no-branch dispatch path returns the same array reference and does not
  mutate its rows.
- Branch paths still isolate any transformations from caller-owned prompt
  rows.
- Restoration `messages` may be returned by reference only for
  `initialMessages`; restoration `scriptstate` remains cloned.
- Stop-sending and rollback flows see the same restoration contents.

## Done Criteria

- A default-provider send performs no `reformatMessages` full-prompt clone.
- A reformatting provider still gets byte-identical transformed rows.
- `buildRestorationPayload` does not clone `initialMessages`.
- Tests prove restoration consumers do not mutate the returned initial message
  array.
- L3 and K3 are registered as `DONE` in the v3 gate and active-risk table,
  with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
