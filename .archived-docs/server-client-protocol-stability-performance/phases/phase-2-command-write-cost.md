# Phase 2: Command Write Cost

Status: hot command paths targeted; generation assembly side-effect writes
narrowed. A candidate measurement slice exists for prompt-construction
whole-corpus read/construction cost.

Goal: reduce whole-corpus command mutation work while preserving revision,
event, transaction, and projection contracts.

## Source Anchors

- [`../../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/routes/generationChat.ts`

## Slices

- [`command-family-measurement.md`](slices/phase-2-command-write-cost/command-family-measurement.md) -
  completed; measured settings, plugin storage, chat, message, and generation
  command families.
- [`scoped-settings-mutation-path.md`](slices/phase-2-command-write-cost/scoped-settings-mutation-path.md) -
  implemented; `settings.updated` uses the message-free mutation path.
- [`scoped-plugin-storage-mutation-path.md`](slices/phase-2-command-write-cost/scoped-plugin-storage-mutation-path.md) -
  implemented; plugin-storage put/delete/bulk commands use the message-free
  mutation path.
- [`message-chat-targeted-persistence.md`](slices/phase-2-command-write-cost/message-chat-targeted-persistence.md) -
  implemented; `chat.updated` uses the message-free mutation path and
  message append/edit/delete/truncate/replace use targeted SQLite message
  paths.
- [`generation-persistence-narrow-path.md`](slices/phase-2-command-write-cost/generation-persistence-narrow-path.md) -
  implemented; `generation.persisted` uses a targeted SQLite generation
  message path.
- [`generation-prompt-side-effect-measurement.md`](slices/phase-2-command-write-cost/generation-prompt-side-effect-measurement.md) -
  implemented; prompt assembly, database load/hydration, and assembly-time
  side-effect persistence emit opt-in protocol metrics for the remaining
  generation whole-corpus risk.
- [`generation-prompt-metric-review.md`](slices/phase-2-command-write-cost/generation-prompt-metric-review.md) -
  implemented; representative generation/prompt metric samples identify
  assembly-time side effects as the remaining hydrated mutation path.
- [`generation-assembly-side-effect-narrow-path.md`](slices/phase-2-command-write-cost/generation-assembly-side-effect-narrow-path.md) -
  implemented; eligible assembly-time scriptstate and transcript-rewrite
  persistence use the `targeted-assembly` mutation path.
- [`generation-prompt-construction-pass-measurement.md`](slices/phase-2-command-write-cost/generation-prompt-construction-pass-measurement.md) -
  candidate; measure prompt assembly load/construction phases before any
  further runtime narrowing.

## Exit Criteria

- Migrated hot command families avoid unnecessary full message hydration.
- `baseRevision`, one revision bump, and one command event semantics are
  unchanged.
- `db.json` never lands ahead of the durable SQLite rows it depends on.
- Metrics show the migrated family reduced command latency or whole-corpus
  work.

## Validation

- Focused command tests for each migrated family.
- `pnpm api:test`
- `pnpm client-thinning:audit`
