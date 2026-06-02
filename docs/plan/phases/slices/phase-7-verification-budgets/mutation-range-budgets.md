# Mutation-Range Budgets

Status: planned. Maintained as each tier lands.

## Source Anchors

- `server/fastify/__tests__/commandMetrics.test.ts` - the `mutationPath` review
  gate map and `dbJsonWriteMs` checks (~32, ~46-56, ~324-339).
- `server/fastify/__tests__/commands.test.ts` - `tableRowidsById` (~161,
  ~3269-3284), `activeMessageRowids` (~150).
- [`../phase-0-baseline-foundations/mutation-range-metric-and-gates.md`](../phase-0-baseline-foundations/mutation-range-metric-and-gates.md) -
  the written-table-set metric and review-gate template.

## Scope

Turn each narrow path's proof into a maintained gate so a later edit cannot
silently widen a route's write range. For every new `mutationPath` introduced in
Phases 2-4, add a `commandMetrics.test.ts` review-gate entry asserting:

- `dbJsonWriteMs: 0` (the targeted-path floor, like `targeted-character-selection`).
- The written-table set equals the tables the audit names for that route family
  (e.g. `targeted-settings` → `{settings}`; `targeted-plugin-storage` →
  `{plugin_custom_storage}`; `targeted-collection` → `{<one table>}` plus
  `{settings}` where the pointer co-write applies).
- A rowid-stability assertion (`tableRowidsById` / `activeMessageRowids`) proving
  the unrelated character/chat/collection/message rows keep their rowids.

## Implementation Scope

- Source files: `server/fastify/__tests__/commandMetrics.test.ts`,
  `server/fastify/__tests__/commands.test.ts`.
- One gate entry per `mutationPath`; the per-route written-table set is the
  budget. Two-table cases (presets apply, modules scripts/triggers) declare both
  tables explicitly so the budget is not silently looser than the route.
- Non-scope: the route narrowing itself (Phases 2-4).

## Protocol Behavior

- The gates are opt-in measurement plus deterministic assertions; no runtime
  behavior changes.
- A widened write (an accidental return to a broad `replaceAll*`) fails the
  written-table-set assertion, not just a timing threshold.

## Done When

- Every narrow `mutationPath` from Phases 2-4 has a `dbJsonWriteMs: 0` +
  written-table-set + rowid-stability gate.
- The two-table exceptions are encoded explicitly.
- `commandMetrics.test.ts` fails if any gated route writes a table outside its
  budget.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
