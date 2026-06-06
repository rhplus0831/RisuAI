# Slice: Bergamot Chain Recovery

Phase: [7](../../phase-7-opt-in-subsystems.md). Finding: M19. Runtime change.
Status: done on 2026-06-06.

## Scope

Keep bergamot translations serialized while preventing one rejected translation
or hard wasm failure from poisoning every later call until page reload.

This slice does not change the shared translator API, the generic translate
cache, Google/deepl behavior, or UI retry policy.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M19.
- `src/ts/translator/bergamotTranslator.ts`: module-level `translator`,
  `translateTask`, and `bergamotTranslate`.
- Callers in `src/ts/translator/translator.ts`.
- New focused test home: `src/ts/translator/bergamotTranslator.test.ts`.

## Target Shape

- Preserve one-at-a-time bergamot execution, but await the previous task through
  a recovery path so an earlier rejection does not synchronously rethrow before
  the next translation starts.
- Clear or replace `translateTask` in `finally`, or chain with a swallowed
  prior rejection before scheduling the next translator call.
- On hard translator/wasm initialization or execution errors, clear the cached
  `LatencyOptimisedTranslator` instance so the next call can re-create it.
- Do not swallow the current call's error from the current caller. The failing
  request should still reject; only future requests should recover.
- Add tests for serialized success order, rejection of the current call,
  recovery on the next call after rejection, and translator re-instantiation
  after a simulated hard wasm failure.
- Register M19 as `DONE` in the v2 gate with focused tests, and flip the M19
  row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Calls remain serialized; do not allow concurrent access to the bergamot
  translator instance.
- Successful target text and HTML-mode arguments are passed through unchanged.
- The `clearCache()` model-cache behavior is unchanged.
- A failed call must reject to its caller exactly once.

## Done Criteria

- [x] A rejected bergamot translation does not make the next unrelated translation
  fail before it reaches the translator.
- [x] A simulated hard translator failure clears cached state and the next call can
  initialize a fresh translator.
- [x] The M19 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/translator/bergamotTranslator.test.ts src/ts/translator/presets.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
