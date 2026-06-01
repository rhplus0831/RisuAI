# Phase 2: Command Write Cost

Status: two migrations implemented.

Goal: reduce whole-corpus command mutation work while preserving revision,
event, transaction, and projection contracts.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/routes/generationChat.ts`

## Slices

- [`command-family-measurement.md`](slices/phase-2-command-write-cost/command-family-measurement.md) -
  completed; selected `settings.updated` with metric evidence.
- [`scoped-settings-mutation-path.md`](slices/phase-2-command-write-cost/scoped-settings-mutation-path.md) -
  implemented; `settings.updated` uses the message-free mutation path.
- [`scoped-plugin-storage-mutation-path.md`](slices/phase-2-command-write-cost/scoped-plugin-storage-mutation-path.md) -
  implemented; plugin-storage put/delete/bulk commands use the message-free
  mutation path.
- [`message-chat-targeted-persistence.md`](slices/phase-2-command-write-cost/message-chat-targeted-persistence.md)
- [`generation-persistence-narrow-path.md`](slices/phase-2-command-write-cost/generation-persistence-narrow-path.md)

## Exit Criteria

- Migrated command families avoid unnecessary full message hydration.
- `baseRevision`, one revision bump, and one command event semantics are
  unchanged.
- `db.json` never lands ahead of the durable SQLite rows it depends on.
- Metrics show the migrated family reduced command latency or whole-corpus
  work.

## Validation

- Focused command tests for each migrated family.
- `pnpm api:test`
- `pnpm client-thinning:audit`
