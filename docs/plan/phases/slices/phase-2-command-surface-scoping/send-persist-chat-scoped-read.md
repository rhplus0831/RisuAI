# Slice: Send Persist Chat-Scoped Read

Phase: [2](../../phase-2-command-surface-scoping.md). Finding: M1. Depends on
the existing `chatScopedRead` loader and the v2 K1 sibling shape. Runtime
change.

## Scope

Wire the existing chat-scoped read into `persistAssemblyMutations` when
trigger/editinput send assembly persists a transcript replacement without a
chat-variable write. The broad path stays for chat-variable writes because
that branch still uses `writeDatabase`.

This slice does not own the plain-send append fast path, trigger execution
costs, or the accepted v1-L4 breadth for var-write persistence.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M1.
- [`../../phase-2-command-surface-scoping.md`](../../phase-2-command-surface-scoping.md)
  planned slice notes and exit criteria.
- `server/fastify/src/routes/generationChat.ts`:
  `persistAssemblyMutations`, `hasVarWrite`, `submitTranscriptChanged`,
  `createAssemblyTranscriptMessage`, `replaceActiveChatMessages`,
  `appendActiveChatMessageTail`, and the sibling
  `persistServerGenerationResult`.
- `server/fastify/src/commands/mutations.ts`: `applyTargetedCommandMutation`,
  `chatScopedRead`, `writeDatabase` incompatibility guards.
- `server/fastify/src/repository.ts`: `loadPersistedForChatMutation`.
- Focused tests: `server/fastify/__tests__/generation.chat.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`.

## Target Shape

- In `persistAssemblyMutations`, pass
  `chatScopedRead: hasVarWrite ? undefined : { chatId: args.input.chatId }`.
- Keep `writeDatabase: hasVarWrite`. Do not combine `chatScopedRead` with the
  var-write branch.
- Preserve the early return when there are no chat-var mutations and no
  transcript replacement.
- Preserve append-tail optimization, full replacement fallback, duplicate
  message-id validation, revision bumping, command-event persistence, and SSE
  revision reporting.
- Add a regression test for a trigger/editinput transcript replacement with no
  var write that proves zero whole-corpus payload reads.
- Assert the `messages.replaced` event uses `parentId: character.chaId` from
  the scoped loader. This path must not accidentally use the chat id as the
  parent.
- Add/keep a var-write test proving the broad `writeDatabase` path remains
  intentional and truthfully visible.

## Invariants

- Plain sends that do not persist assembly mutations perform no database load
  from this helper.
- No-var transcript persistence reads only the target chat row plus parent
  character data needed by `requireChatLocation`.
- Chat-variable writes stay on the broad path and remain gated; do not hide
  them behind a narrow metric.
- Persisted messages, command events, parent ids, and responses stay
  byte-identical outside the load-count proof.

## Done Criteria

- The load-cost harness fails if a no-var trigger/editinput transcript
  persistence reaches `loadPersisted`.
- A focused generation test asserts the `messages.replaced` event parent id is
  the character id.
- The var-write branch still exercises the broad `writeDatabase` path with an
  explicit test or metric assertion.
- M1 is registered as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flipped in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the implementation change.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
