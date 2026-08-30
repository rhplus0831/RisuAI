# Prompt-Memory Query Seam

Status: complete at `e520f5bb7`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: memory-embedding settings at `3a96d8505`.

## Objective

Replace `promptMemoryQuery.ts`'s aggregate browser database/message declaration
with Fastify-owned query-source, character, chat, and message projections plus
the existing memory-embedding settings contract.

## Boundary

- Query source: chat/character IDs, operation mode, regenerate target, and
  optional pending user message.
- Transcript: only role, text, chat ID, name, disabled/reset, and speaker fields.
- Delivered delta: one production type-only browser-application-model edge.

## Behavior Contract

Preserve send deduplication, regenerate-tail trimming, disabled/reset filtering,
query-count slicing before empty-text removal, summary/model compatibility,
embedding provider deadlines/abort diagnostics, and empty-vector fallback.

## Verification

Direct query projection, closed ownership, and generation-chat suites passed 3,
1, and 181 tests. Both typechecks, the 232-edge architecture inventory,
formatting, and diff checks passed.
