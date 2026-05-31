# Command Metric Thresholds

Status: planned.

## Source Anchors

- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`

## Scope

Turn command mutation metrics into thresholds or review gates for hot command
families after Phase 2 establishes baseline and migrated paths.

## Protocol Behavior

- Do not set CI thresholds until normal variance is understood.
- Keep thresholds family-specific when command shapes have different expected
  cost.
- Include `loadMs`, `cloneMutateMs`, `sqliteSyncMs`, `dbJsonWriteMs`, and
  `totalMs`.

## Done When

- At least one hot command family has a documented metric budget.
- Regression review can identify which command section got slower.

## Validation

- Metric harness or focused tests introduced by this slice.
- `pnpm api:test`
