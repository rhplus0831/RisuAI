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
showed `message.appended` was a hot message-table-only write; that command now
uses a targeted SQLite append path:

| Command type            | mutationPath     | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ----------------------- | ---------------- | -----: | ------------: | -----------: | ------------: | ------: |
| `settings.updated`      | message-free     |   0.38 |          0.22 |         0.14 |          0.51 |    2.87 |
| `pluginStorage.updated` | message-free     |   0.38 |          0.23 |         0.12 |          0.53 |    2.84 |
| `chat.updated`          | message-free     |   0.33 |          1.10 |         0.15 |          0.55 |    3.53 |
| `message.appended`      | targeted-message |   0.38 |          1.13 |         0.08 |          0.00 |    3.06 |
| `generation.persisted`  | hydrated         |   7.16 |         18.34 |         3.75 |          0.63 |   31.31 |

Message edit/delete/replace and `generation.persisted` intentionally remain on
the hydrated generic path until their targeted persistence rules are scoped in
separate slices.

## Follow-Up Slices

- [`scoped-settings-mutation-path.md`](scoped-settings-mutation-path.md) -
  implemented.
- [`scoped-plugin-storage-mutation-path.md`](scoped-plugin-storage-mutation-path.md) -
  implemented.
- [`message-chat-targeted-persistence.md`](message-chat-targeted-persistence.md) -
  partially implemented for `message.appended`.
- [`generation-persistence-narrow-path.md`](generation-persistence-narrow-path.md) -
  planned.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- Focused command tests for selected families.
