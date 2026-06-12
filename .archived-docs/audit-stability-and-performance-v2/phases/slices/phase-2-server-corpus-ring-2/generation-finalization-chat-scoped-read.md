# Slice: Generation Finalization Chat-Scoped Read

Phase: [2](../../phase-2-server-corpus-ring-2.md). Finding: K1. Depends on the
targeted writer kit and v2 gate being present. Runtime change.

## Scope

Wire the existing `chatScopedRead` option into durable generation
finalization persistence when finalization only appends/replaces the generated
message. The existing broad path stays for the chat-variable write case because
that path still writes the database snapshot.

This slice does not own the accepted v1-L4 breadth for chat-variable writes,
generation job lifecycle, provider streaming, retry table retention, or message
diff optimization.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  Known-Item Overlaps K1 / v1-L6 residual.
- [`../../phase-2-server-corpus-ring-2.md`](../../phase-2-server-corpus-ring-2.md)
  planned shape.
- `server/fastify/src/routes/generationChat.ts`:
  `persistServerGenerationResult`, `hasScriptstateWrite`,
  `writeGenerationChatMessage`, `normalizeAllCharacterChats`.
- `server/fastify/src/commands/mutations.ts`: `applyTargetedCommandMutation`,
  `chatScopedRead`, `writeDatabase` incompatibility.
- `server/fastify/src/repository.ts`: `loadPersistedForChatMutation`.
- Existing focused tests:
  `server/fastify/__tests__/generation.chat.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`,
  `server/fastify/__tests__/commandMetrics.test.ts`.

## Target Shape

- In `persistServerGenerationResult`, pass
  `chatScopedRead: { chatId: args.chatId }` when `hasScriptstateWrite` is
  false.
- Keep `writeDatabase: hasScriptstateWrite`; when chat variables are written,
  continue to use the broad read/write path and do not combine it with
  `chatScopedRead`.
- Preserve message append/replace behavior, target-message lookup errors,
  duplicate message id errors, reroll alternate persistence, event shape, and
  revision handling.
- Add load-count coverage for a generation finalization with no chat-variable
  mutations that proves the path reaches `loadPersistedForChatMutation`, not
  `loadPersisted`.
- Add a guard test for a finalization with chat-variable mutations proving the
  broad path remains intentionally gated and behavior is unchanged.
- Register K1 as `DONE` in the v2 gate with focused tests, and flip the K1 row
  in [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the same commit.

## Invariants

- `chatScopedRead` must only be used for message-only finalization.
- Broad chat-variable writes remain visible and gated; do not hide them behind
  a false narrow metric.
- Persisted message rows, alternate rows, revision bumps, and command events
  must be byte-identical to the current fixtures.
- Reattach/durable retry behavior must not change.

## Done Criteria

- Message-only finalization performs zero whole-corpus loads in the load-cost
  harness.
- Chat-variable finalization keeps the broad write path and has explicit test
  evidence for that decision.
- Command metrics identify the narrowed path and continue to report the broad
  var-write case truthfully.
- The v2 gate and active-risk row mark K1 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
RISU_COMMAND_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMetrics.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
