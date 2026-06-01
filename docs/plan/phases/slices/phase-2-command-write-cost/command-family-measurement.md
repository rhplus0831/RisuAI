# Command Family Measurement

Status: completed on 2026-06-01.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/commands.ts`

## Scope

Use Phase 0 metrics to select the first command families for narrow persistence
paths. Do not pick candidates by intuition alone.

## Measurement Harness

Added `server/fastify/__tests__/commandMetrics.test.ts`. It seeds a
message-heavy save with 12 characters, 8 chats per character, and 40 messages
per chat, then exercises representative command families while
`RISU_PROTOCOL_METRICS=1` captures `command_mutation` rows.

Run the focused measurement with:

```bash
RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose
```

Measured locally on 2026-06-01:

| Command type            | Resource        | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ----------------------- | --------------- | -----: | ------------: | -----------: | ------------: | ------: |
| `settings.updated`      | `settings`      |   7.75 |          4.18 |         3.50 |          0.61 |   17.50 |
| `pluginStorage.updated` | `pluginStorage` |   5.81 |          4.59 |         2.52 |          0.45 |   14.89 |
| `chat.updated`          | `chat`          |   5.64 |         10.24 |         2.52 |          0.57 |   20.50 |
| `message.appended`      | `message`       |   6.78 |         15.94 |         3.61 |          0.55 |   28.37 |
| `generation.persisted`  | `generation`    |   7.04 |         16.90 |         3.20 |          0.53 |   29.10 |

## Candidate Signals

- High `loadMs` or `cloneMutateMs` for commands that do not inspect messages.
- High `sqliteSyncMs` from scanning chats where no messages changed.
- High `dbJsonWriteMs` for small settings or metadata edits.

## Selected Candidate

Select `settings.updated` first and continue in
[`scoped-settings-mutation-path.md`](scoped-settings-mutation-path.md).

Metric evidence:

- `settings.updated` does not inspect chat messages, yet on the seeded save it
  spent 7.75ms loading the hydrated corpus, 4.18ms cloning/mutating, and 3.50ms
  running SQLite message sync for a scalar settings edit.
- `pluginStorage.updated` shows the same non-message command shape, but
  settings has a dedicated follow-up slice and is called out in the active loop
  risks, so it is the narrower first migration.
- Message-inspecting families, including `message.appended` and
  `generation.persisted`, stay on the generic path until their targeted
  persistence rules are explicit.

Before/after measurement plan for the settings slice:

- Re-run the command metrics harness before implementation to capture the local
  baseline for `settings.updated`.
- After the scoped path lands, re-run the same harness and compare
  `settings.updated` `loadMs`, `cloneMutateMs`, `sqliteSyncMs`, and `totalMs`
  against the baseline.
- Confirm unrelated `chat`, `message`, and `generation` command metrics remain
  on the generic path.

## Done When

- The first candidate family is named with metric evidence.
- High-cross-write or message-inspecting command families stay on the generic
  path until their safety rules are explicit.
- The selected slice includes a before/after measurement plan.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- Focused command tests for selected families.
