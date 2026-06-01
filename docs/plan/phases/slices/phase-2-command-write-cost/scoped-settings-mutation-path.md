# Scoped Settings Mutation Path

Status: selected next.

## Source Anchors

- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `src/ts/server/settingsBridge.svelte.ts`

## Scope

Add a narrow command path for settings-like scalar updates that do not need
hydrated chat messages. The command-family measurement slice selected
`settings.updated` first because it spent whole-corpus load, clone, and message
sync time for a scalar settings edit on a message-heavy save.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`, and `server/fastify/src/repository.ts`.
- Protocol surface: `PATCH /api/v1/commands/settings/:group`.
- Durable path: mutate message-free `db.json` settings fields without calling
  `loadPersistedWithMessages()` or `syncChatMessages()`.
- Revision/event behavior: preserve `baseRevision` conflict checks, one
  revision bump, one persisted `settings.updated` event, and one live event
  emission.
- Rollback/resync behavior: leave `db.json` untouched on validation,
  conflict, or pre-commit failures; write `db.json` only after SQLite commit so
  the next bootstrap/resync never observes JSON ahead of revision/event rows.
- Non-scope: message, chat metadata, generation persistence, provider secret
  placeholder semantics outside the existing settings patch validation.

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
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
