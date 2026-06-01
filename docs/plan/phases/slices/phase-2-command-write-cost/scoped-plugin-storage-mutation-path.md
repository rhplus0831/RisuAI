# Scoped Plugin Storage Mutation Path

Status: implemented on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/commands/pluginStorage.ts`
- `server/fastify/__tests__/commands.test.ts`
- `server/fastify/__tests__/commandMetrics.test.ts`

## Scope

Move plugin-storage commands that only mutate `database.pluginCustomStorage` to
the message-free command mutation path. The command-family metrics harness
showed `pluginStorage.updated` had the same non-message shape as
`settings.updated`, but still paid hydrated database load, clone, chat diff,
and message sync cost.

Implemented routes:

- `PUT /api/v1/commands/plugin-storage/:key`
- `DELETE /api/v1/commands/plugin-storage/:key`
- `POST /api/v1/commands/plugin-storage/bulk`

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` and
  `server/fastify/__tests__/commandMetrics.test.ts`.
- Protocol surface: existing plugin-storage command routes only.
- Durable path: mutate message-free `db.json` plugin storage without calling
  `loadPersistedWithMessages()` or `syncChatMessages()`.
- Revision/event behavior: preserve `baseRevision` conflict checks, one
  revision bump, one persisted command event, and one live event emission.
- Rollback/resync behavior: keep `db.json` untouched on validation, conflict,
  or pre-commit failures; write `db.json` only after SQLite revision/event rows
  commit.
- Non-scope: plugin definitions, plugin ordering, plugin runtime behavior,
  plugin-storage projection fallback behavior, and local/browser plugin effects.

## Protocol Behavior

- Preserve existing validators for plugin-storage keys, values, bulk deletes,
  and bulk clears.
- Preserve response shapes and event types:
  `pluginStorage.updated`, `pluginStorage.deleted`, and
  `pluginStorage.bulkUpdated`.
- Keep unrelated command families on their current paths until their ownership
  and persistence rules are explicit. Later commits used this same rule to
  narrow chat metadata, message history, and generation persistence.

## Done When

- Plugin-storage commands avoid hydrated database load and chat message sync.
- Command metrics report `mutationPath: "message-free"` for
  `pluginStorage.updated`.
- Focused command tests prove unchanged command behavior for put/delete/bulk,
  validation failures, stale revision handling, and event persistence.

## Measurement

Local command metrics harness on 2026-06-01:

| Command type             | mutationPath | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ------------------------ | ------------ | -----: | ------------: | -----------: | ------------: | ------: |
| before plugin storage    | hydrated     |   6.32 |          6.74 |         3.56 |          0.46 |   18.63 |
| after plugin storage     | message-free |   0.44 |          0.26 |         0.12 |          0.42 |    2.77 |
| after settings           | message-free |   0.51 |          0.35 |         0.19 |          0.70 |    3.37 |
| then-hydrated chat       | hydrated     |   6.44 |         10.55 |         3.08 |          0.54 |   22.16 |
| then-hydrated message    | hydrated     |   5.85 |         15.39 |         2.89 |          0.56 |   26.17 |
| then-hydrated generation | hydrated     |   6.57 |         17.47 |         3.30 |          0.59 |   29.48 |

## Validation

- `pnpm api:test __tests__/commands.test.ts __tests__/commandMetrics.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm client-thinning:audit`
