# Slice: Server-Intent Completion Settings Loader

Phase: [2](../../phase-2-server-corpus-ring-2.md). Finding: L3. Depends on the
v2 gate being present. Runtime change.

## Scope

Stop `server-intent` `/generate/completion` calls from loading the full
persisted corpus just to dispatch secondary AI requests such as translate,
memory, emotion, `otherAx`, or submodel completion. The route should build the
same provider-facing completion database from settings-scale data.

This slice does not own main chat prompt assembly, provider adapters, proxy
timeouts, or any full database route outside server-intent completion.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L3.
- `server/fastify/src/routes/generation.ts`:
  `handleServerIntentCompletion`, `selectedCompletionModel`,
  `buildCompletionDatabase`, `dispatchChatProvider`.
- `server/fastify/src/repository.ts`: `loadPersisted`,
  `loadSettingsFromSqlite`, and any scoped loader added for settings-only
  server paths.
- Existing focused tests:
  `server/fastify/__tests__/generation.completion.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`,
  `server/fastify/__tests__/payloadBudgets.test.ts`.

## Target Shape

- Replace the `loadPersisted` call in `handleServerIntentCompletion` with a
  settings-sized loader that returns the fields needed by
  `selectedCompletionModel`, `buildCompletionDatabase`, and
  `dispatchChatProvider`.
- Preserve the uninitialized database response: if settings are absent, the
  route should still return `400 database is not initialized`.
- Preserve body validation and provider-dispatch behavior for all completion
  modes: `model`, `submodel`, `memory`, `emotion`, `otherAx`, and `translate`.
- Keep `staticModel`, `maxTokens`, `temperature`, `stream`, and
  `currentCharName` semantics. If `currentCharName` currently needs a
  compatibility `characters` shape, synthesize or load the minimal shape
  required and test it; ordinary server-intent calls must not read the
  `characters` table.
- Add load-count coverage proving a normal server-intent completion performs
  zero `loadPersisted` calls and zero character/chat row parses.
- Register L3 as `DONE` in the v2 gate with focused behavior and load-count
  tests, and flip the L3 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the same commit.

## Invariants

- Provider request payloads, SSE/non-SSE completion responses, and validation
  errors must remain byte-identical for existing fixtures.
- The loader must not accidentally include plugin storage, assets metadata, or
  collections unless a provider path demonstrably needs them.
- Abort cleanup from `attachAbort` must remain unchanged.
- This route must stay independent of main chat prompt assembly.

## Done Criteria

- Focused completion tests pass for streaming and non-streaming
  server-intent requests.
- Load-cost assertions fail if server-intent completion reaches
  `loadPersisted` or parses character/chat rows for the ordinary mode cases.
- The v2 gate and active-risk row mark L3 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.completion.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/payloadBudgets.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
