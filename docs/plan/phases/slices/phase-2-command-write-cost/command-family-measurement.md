# Command Family Measurement

Status: planned.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/commands.ts`

## Scope

Use Phase 0 metrics to select the first command families for narrow persistence
paths. Do not pick candidates by intuition alone.

## Candidate Signals

- High `loadMs` or `cloneMutateMs` for commands that do not inspect messages.
- High `sqliteSyncMs` from scanning chats where no messages changed.
- High `dbJsonWriteMs` for small settings or metadata edits.

## Done When

- The first candidate family is named with metric evidence.
- High-cross-write or message-inspecting command families stay on the generic
  path until their safety rules are explicit.
- The selected slice includes a before/after measurement plan.

## Validation

- Manual or test metric readout with `RISU_PROTOCOL_METRICS=1`.
- Focused command tests for selected families.
