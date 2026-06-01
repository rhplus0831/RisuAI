# Command Metric Thresholds

Status: implemented.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/__tests__/commandMetrics.test.ts`

## Scope

Turn the Phase 2 command metric harness into thresholds or review gates for hot
command families.

Implemented scope:

- Added command metric review-gate metadata to the Phase 2 harness so each hot
  command metric must resolve to a known `mutationPath` review gate.
- Kept wall-clock timings as review readouts instead of CI ceilings while
  variance is still being characterized.
- Continued hard-path checks for stable structural budgets: `message-free`
  commands must stay on their narrow path, targeted message commands must stay
  `targeted-message`, targeted generation persistence must stay
  `targeted-generation`, and targeted paths must keep `dbJsonWriteMs: 0`.
- Extended `RISU_COMMAND_METRIC_SUMMARY=1` output with the review-gate label so
  regression review can see which budget each command row belongs to.

## Protocol Behavior

- Do not set CI thresholds until normal variance is understood.
- Keep thresholds family-specific when command shapes have different expected
  cost.
- Include `loadMs`, `cloneMutateMs`, `sqliteSyncMs`, `dbJsonWriteMs`, and
  `totalMs`.
- Treat the following as maintained review gates:

| mutationPath          | Review gate                                                 | Hard structural budget |
| --------------------- | ----------------------------------------------------------- | ---------------------- |
| `message-free`        | Avoid message history synchronization work.                 | Narrow path retained.  |
| `targeted-message`    | Avoid `db.json` rewrites for message-row commands.          | `dbJsonWriteMs = 0`.   |
| `targeted-generation` | Avoid `db.json` rewrites for generation result persistence. | `dbJsonWriteMs = 0`.   |

Representative focused metrics captured while implementing this slice on
2026-06-01:

| Command type            | mutationPath        | loadMs | cloneMutateMs | sqliteSyncMs | dbJsonWriteMs | totalMs |
| ----------------------- | ------------------- | -----: | ------------: | -----------: | ------------: | ------: |
| `settings.updated`      | message-free        |   0.35 |          0.20 |         0.12 |          0.48 |    2.69 |
| `pluginStorage.updated` | message-free        |   0.49 |          0.34 |         0.17 |          0.58 |    3.16 |
| `chat.updated`          | message-free        |   0.35 |          1.28 |         0.16 |          0.55 |    3.77 |
| `message.appended`      | targeted-message    |   0.33 |          0.98 |         0.10 |          0.00 |    2.84 |
| `message.updated`       | targeted-message    |   0.35 |          1.29 |         0.08 |          0.00 |    3.12 |
| `message.deleted`       | targeted-message    |   0.33 |          0.95 |         0.08 |          0.00 |    2.91 |
| `message.truncated`     | targeted-message    |   0.36 |          0.89 |         0.14 |          0.00 |    2.80 |
| `messages.replaced`     | targeted-message    |   0.42 |          1.00 |         0.11 |          0.00 |    2.97 |
| `generation.persisted`  | targeted-generation |   0.39 |          1.12 |         0.10 |          0.00 |    2.96 |

## Done When

- At least one hot command family has a documented metric budget.
- Regression review can identify which command section got slower.

Done.

## Validation

- Metric harness or focused tests introduced by this slice.
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
