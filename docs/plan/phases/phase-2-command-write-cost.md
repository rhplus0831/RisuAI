# Phase 2: Command Write Cost

Status: planned.

Goal: reduce whole-corpus command mutation work while preserving revision,
event, transaction, and projection contracts.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/routes/generationChat.ts`

## Slices

- [`command-family-measurement.md`](slices/phase-2-command-write-cost/command-family-measurement.md)
- [`scoped-settings-mutation-path.md`](slices/phase-2-command-write-cost/scoped-settings-mutation-path.md)
- [`message-chat-targeted-persistence.md`](slices/phase-2-command-write-cost/message-chat-targeted-persistence.md)
- [`generation-persistence-narrow-path.md`](slices/phase-2-command-write-cost/generation-persistence-narrow-path.md)

## Exit Criteria

- The first migrated command family avoids unnecessary full message hydration.
- `baseRevision`, one revision bump, and one command event semantics are
  unchanged.
- `db.json` never lands ahead of the durable SQLite rows it depends on.
- Metrics show the migrated family reduced command latency or whole-corpus
  work.

## Validation

- Focused command tests for each migrated family.
- `pnpm api:test`
- `pnpm client-thinning:audit`
