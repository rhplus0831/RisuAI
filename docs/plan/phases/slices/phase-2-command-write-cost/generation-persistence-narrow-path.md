# Generation Persistence Narrow Path

Status: planned.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/messageStore.ts`

## Scope

Reduce whole-corpus persistence passes around chat generation side effects and
final result persistence where the required writes can be represented as
targeted message, scriptstate, or metadata changes.

## Protocol Behavior

- Preserve idempotence by `generationId`.
- Preserve final assistant message persistence and scriptstate behavior.
- Keep prompt assembly side effects explicit, measured, and revision-tracked
  when they affect projected state.

## Done When

- Generation persistence avoids unnecessary full database clone work for a
  selected path.
- Transient and terminal persistence failures remain visible.
- Tests prove no duplicate assistant rows for repeated persistence attempts.

## Validation

- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- Focused generation persistence tests.
