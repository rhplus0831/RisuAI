# Targeted Mutation Paths

Status: planned. Depends on [`targeted-writer-kit.md`](targeted-writer-kit.md).

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
existing `targeted-*` family.

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

- Each `mutationPath` label exists and is reachable from a helper.
- A focused test routes a sample command through each path and asserts the
  revision/event shape matches the generic path.
- The helpers report their `mutationPath` to the metric (Phase 0 metric slice).

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
