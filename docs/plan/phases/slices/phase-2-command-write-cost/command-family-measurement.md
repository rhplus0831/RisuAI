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

The harness first showed that `settings.updated` and
`pluginStorage.updated` had non-message mutation shapes but still paid
whole-corpus load/clone/chat-diff cost. Both now use message-free mutation
paths:

| Command type            | mutationPath | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ----------------------- | ------------ | -----: | ------------: | -----------: | ------------: | ------: |
| `settings.updated`      | message-free |   0.51 |          0.35 |         0.19 |          0.70 |    3.37 |
| `pluginStorage.updated` | message-free |   0.44 |          0.26 |         0.12 |          0.42 |    2.77 |
| `chat.updated`          | hydrated     |   6.44 |         10.55 |         3.08 |          0.54 |   22.16 |
| `message.appended`      | hydrated     |   5.85 |         15.39 |         2.89 |          0.56 |   26.17 |
| `generation.persisted`  | hydrated     |   6.57 |         17.47 |         3.30 |          0.59 |   29.48 |

`chat`, `message`, and `generation` intentionally remain on the hydrated
generic path until their targeted persistence rules are scoped in separate
slices.

## Follow-Up Slices

- [`scoped-settings-mutation-path.md`](scoped-settings-mutation-path.md) -
  implemented.
- [`scoped-plugin-storage-mutation-path.md`](scoped-plugin-storage-mutation-path.md) -
  implemented.
- [`message-chat-targeted-persistence.md`](message-chat-targeted-persistence.md) -
  planned.
- [`generation-persistence-narrow-path.md`](generation-persistence-narrow-path.md) -
  planned.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- Focused command tests for selected families.
