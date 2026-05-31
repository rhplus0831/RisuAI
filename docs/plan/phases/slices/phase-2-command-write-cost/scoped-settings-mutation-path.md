# Scoped Settings Mutation Path

Status: planned.

## Source Anchors

- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `src/ts/server/settingsBridge.svelte.ts`

## Scope

Add a narrow command path for settings-like scalar updates that do not need
hydrated chat messages. This is a likely first migration candidate if metrics
confirm the cost.

## Protocol Behavior

- Preserve `baseRevision` conflict checks.
- Preserve one revision bump and one command event.
- Preserve provider secret handling and masking behavior.
- Write durable state only after the SQLite transaction has committed the
  necessary revision/event rows.

## Done When

- Selected settings commands avoid `loadPersistedWithMessages()`.
- Revision conflict, event, and response shapes match the generic path.
- Equality-noop settings writes are skipped or coalesced where appropriate.

## Validation

- Focused server command tests for migrated settings groups.
- `pnpm api:test`
- `pnpm client-thinning:audit`
