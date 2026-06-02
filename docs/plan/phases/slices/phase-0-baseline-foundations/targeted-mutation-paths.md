# Targeted Mutation Paths

Status: implemented (2026-06-03). Depends on
[`targeted-writer-kit.md`](targeted-writer-kit.md).

## Source Anchors

- `server/fastify/src/commands/mutations.ts` - `applyTargetedCommandMutation`
  (~100), `applyMessageFreeJsonCommandMutation` (~183),
  `applyCharacterSelectionCommandMutation` (~266), `applyJsonCommandMutation`
  (~349).
- `server/fastify/src/repository.ts` - the writer kit.
- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  the four-helper table.

## Scope

Wire the writer kit into the mutation layer so each tier has a vehicle that
matches the reference fix's contract (validate message-free, do targeted SQLite
writes, write `db.json` only after the SQLite commit). Two mechanisms cover every
tier:

- `applyTargetedCommandMutation` with `writeDatabase` unset — the callback does
  its own targeted writes via the kit and skips the broad `replaceAll*`. This is
  the general vehicle for single-row and single-collection writes.
- A bespoke helper mirroring `applyCharacterSelectionCommandMutation` where a
  fixed shape (settings-only, single character row + settings) is reused across
  many routes and a dedicated `mutationPath` label is worth it.

Define the new `mutationPath` labels so the metric and review gates can target
them: `targeted-settings`, `targeted-character-row`, `targeted-chat-row`,
`targeted-collection`, `targeted-plugin-storage`. Keep names aligned with the
existing `targeted-*` family. As landed, these are the `TARGETED_MUTATION_PATHS`
constant in `mutations.ts`; Phases 2-5 pass one of them to
`applyTargetedCommandMutation` and do the narrow write in the callback via the
writer kit (leaving `writeDatabase` off). Each label also has a review-gate entry
in `commandMetricGates.ts`.

## Implementation Scope

- Source files: `server/fastify/src/commands/mutations.ts`, the route call sites
  in `server/fastify/src/routes/commands.ts` (changed per tier, not here).
- Protocol surface: none new; the helpers serve the existing routes.
- Durable path: the callback computes the narrow change and calls the kit writer
  inside the same transaction as the revision bump and command-event insert.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  persisted event, one live emission — unchanged from the generic path.
- Rollback/resync behavior: leave `db.json` untouched on validation, conflict, or
  pre-commit failure; write `db.json` only after the SQLite transaction commits.
- Non-scope: choosing which routes use which path (that is each tier's slice).

## Protocol Behavior

- Each targeted path re-normalizes only its target row and treats global
  normalization as validate-only (see
  [`normalization-scope-policy.md`](normalization-scope-policy.md)).
- `db.json` never lands ahead of the durable SQLite rows it depends on.

## Done When

- [x] Each `mutationPath` label exists (`TARGETED_MUTATION_PATHS`) and is reachable
  from a helper (`applyTargetedCommandMutation` + the writer kit; the fixed-shape
  `targeted-character-selection` keeps its bespoke helper).
- [x] A focused test (`__tests__/targetedMutationPaths.test.ts`) routes a sample
  command through each path and asserts the revision/event shape matches the
  generic path (one bump, one persisted + one live event, narrow return) and that
  the targeted write rolls back atomically on a callback error.
- [x] The helper reports the `mutationPath` and narrow `writtenTables` to the
  metric, verified against each label's review gate (`assertCommandMetricGate`).

## Validation

- `pnpm api:test targetedMutationPaths`
- `pnpm api:test commandMetrics`
- `pnpm api:test`
