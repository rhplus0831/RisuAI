# Command Family Measurement

Status: completed on 2026-06-01.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/__tests__/commandMetrics.test.ts`

## Scope

Use Phase 0 metrics to choose narrow command persistence work. Do not move a
family off the generic hydrated command path until its row ownership,
event/revision behavior, and rollback behavior are explicit.

## Harness

`server/fastify/__tests__/commandMetrics.test.ts` seeds a message-heavy save
with 12 characters, 8 chats per character, and 40 messages per chat. With
`RISU_PROTOCOL_METRICS=1`, it records comparable `command_mutation` rows for
settings, plugin storage, chat, message, and generation commands.

Run focused output with:

```bash
RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose
```

## Result

The harness first showed that `settings.updated`, `pluginStorage.updated`, and
`chat.updated` had non-message mutation shapes but still paid whole-corpus
load/clone/chat-diff cost. They now use message-free mutation paths. It also
showed `message.appended`, message edit/delete/truncate/replace, and
`generation.persisted` were hot message-row writes; those commands now use
targeted SQLite paths. Focused metrics from 2026-06-01:

| Command type            | mutationPath        | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ----------------------- | ------------------- | -----: | ------------: | -----------: | ------------: | ------: |
| `settings.updated`      | message-free        |   0.38 |          0.21 |         0.11 |          0.50 |    2.66 |
| `pluginStorage.updated` | message-free        |   0.42 |          0.23 |         0.11 |          0.45 |    2.73 |
| `chat.updated`          | message-free        |   0.33 |          1.06 |         0.12 |          0.50 |    3.58 |
| `message.appended`      | targeted-message    |   0.33 |          0.89 |         0.07 |          0.00 |    2.82 |
| `message.updated`       | targeted-message    |   0.46 |          1.30 |         0.09 |          0.00 |    3.41 |
| `message.deleted`       | targeted-message    |   0.42 |          1.31 |         0.09 |          0.00 |    3.62 |
| `message.truncated`     | targeted-message    |   0.34 |          0.85 |         0.08 |          0.00 |    3.03 |
| `messages.replaced`     | targeted-message    |   0.33 |          0.75 |         0.07 |          0.00 |    2.68 |
| `generation.persisted`  | targeted-generation |   0.31 |          0.80 |         0.09 |          0.00 |    2.65 |

## Follow-Up Slices

- [`scoped-settings-mutation-path.md`](scoped-settings-mutation-path.md) -
  implemented.
- [`scoped-plugin-storage-mutation-path.md`](scoped-plugin-storage-mutation-path.md) -
  implemented.
- [`message-chat-targeted-persistence.md`](message-chat-targeted-persistence.md) -
  implemented for `chat.updated`, `message.appended`, and message
  edit/delete/truncate/replace.
- [`generation-persistence-narrow-path.md`](generation-persistence-narrow-path.md) -
  implemented.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- Focused command tests for selected families.
