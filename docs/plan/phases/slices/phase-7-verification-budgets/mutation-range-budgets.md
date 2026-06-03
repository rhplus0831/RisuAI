# Mutation-Range Budgets

Status: partially implemented / ongoing. Shared gates exist; per-route/family
budget coverage is maintained and still needs a final completeness pass.

## Source Anchors

- `server/fastify/__tests__/helpers/commandMetricGates.ts` - the `mutationPath`
  review gate map and `dbJsonWriteMs` checks.
- `server/fastify/__tests__/command*Range.test.ts` and
  `server/fastify/__tests__/commands.test.ts` - per-route/family written-table
  and rowid-stability assertions.
- [`../phase-0-baseline-foundations/mutation-range-metric-and-gates.md`](../phase-0-baseline-foundations/mutation-range-metric-and-gates.md) -
  the written-table-set metric and review-gate template.

## Scope

Turn each narrow path's proof into a maintained budget so a later edit cannot
silently widen a route's write range. For every new `mutationPath` introduced in
Phases 2-4, keep a shared review gate and per-route/family assertions for:

- `dbJsonWriteMs: 0` (the targeted-path floor, like `targeted-character-selection`).
- The written-table set equals the tables the audit names for that route family
  (e.g. `targeted-settings` → `{settings}`; `targeted-plugin-storage` →
  `{plugin_custom_storage}`; `targeted-collection` → `{<one table>}` plus
  `{settings}` where the pointer co-write applies).
- A rowid-stability assertion proving unrelated
  character/chat/collection/message rows keep their rowids where row identity is
  the intended budget.

## Implementation Scope

- Source files: `server/fastify/__tests__/helpers/commandMetricGates.ts`,
  `server/fastify/__tests__/command*Range.test.ts`,
  `server/fastify/__tests__/commands.test.ts`.
- One shared gate entry per `mutationPath`; route/family tests carry the tighter
  budget. Explicit exceptions, such as preset apply co-writing
  `prompt_templates`, must stay named so the gate is not silently loose.
- Non-scope: the route narrowing itself (Phases 2-4).

## Protocol Behavior

- The gates are opt-in measurement plus deterministic assertions; no runtime
  behavior changes.
- A widened write (an accidental return to a broad `replaceAll*`) fails the
  written-table-set assertion, not just a timing threshold.

## Done When

- Every narrow `mutationPath` from Phases 2-4 has a `dbJsonWriteMs: 0` gate.
- Every route/family has a written-table and row-scope budget, with exceptions
  encoded explicitly.
- Tests fail if any gated route writes a table outside its budget.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
