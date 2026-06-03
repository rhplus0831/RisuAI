# Mutation-Range Budgets

Status: implemented. The final completeness pass landed: every emittable
`mutationPath` has a gate, every `targeted-*` gate holds the `dbJsonWriteMs: 0`
floor + a written-table budget, and `commandMutationBudget.test.ts` fails on any
gate-map drift (a new route, renamed label, or loosened narrow gate). Per-route /
family written-table + rowid-stability coverage is maintained in the
`command*Range` tests.

## Source Anchors

- `server/fastify/__tests__/helpers/commandMetricGates.ts` - the `mutationPath`
  review gate map and `dbJsonWriteMs` checks.
- `server/fastify/__tests__/commandMutationBudget.test.ts` - the gate-completeness
  invariants (gate set == emitted set; every `targeted-*` gate holds
  `dbJsonWriteMs: 0` + a table budget; no out-of-universe tables).
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

- Every narrow `mutationPath` from Phases 2-4 has a `dbJsonWriteMs: 0` gate. Done.
- Every route/family has a written-table and row-scope budget, with exceptions
  encoded explicitly. Done — the preset `apply` `prompt_templates` co-write and
  the `targeted-assembly` chat-var broad fallback are named in their gates.
- Tests fail if any gated route writes a table outside its budget. Done — the
  `assertCommandMetricGate` written-table checks plus the per-family
  `writtenTables` equality assertions, and `commandMutationBudget.test.ts` fails
  on any gate-map drift before a widened write can reach a gate.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
