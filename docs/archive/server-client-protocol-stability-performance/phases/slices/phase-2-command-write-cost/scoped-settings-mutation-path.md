# Scoped Settings Mutation Path

Status: implemented on 2026-06-01.

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

Implemented by routing `PATCH /api/v1/commands/settings/:group` through a
message-free command mutation helper. Later Phase 2 commits applied the same
measurement-first rule to plugin storage, chat metadata, message history, and
generation persistence; the generic hydrated command path remains for
unmigrated complex commands.

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
- Settings metrics report `mutationPath: "message-free"`.

## Measurement

Local before/after harness on 2026-06-01:

| Command type       | mutationPath | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ------------------ | ------------ | -----: | ------------: | -----------: | ------------: | ------: |
| before settings    | hydrated     |   8.01 |          4.11 |         3.44 |          0.75 |   17.97 |
| after settings     | message-free |   0.43 |          0.27 |         0.17 |          0.71 |    3.17 |
| after plugin store | hydrated     |   6.32 |          6.74 |         3.56 |          0.46 |   18.63 |

Plugin storage later moved to its own message-free path in
[`scoped-plugin-storage-mutation-path.md`](scoped-plugin-storage-mutation-path.md).

## Validation

- `pnpm api:test __tests__/commands.test.ts __tests__/commandMetrics.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
