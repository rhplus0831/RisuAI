# Phase 0: Baseline Foundations

Status: planned.

Goal: add the shared scaffolding later tiers need: targeted SQLite writers,
targeted mutation paths, `mutationPath` labels, mutation-range metrics, review
gates, and the normalization-scope policy. This phase does not narrow routes; it
makes narrowing possible and provable.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) -
  prerequisites 1-3 and the reference fix.
- `server/fastify/src/repository.ts` - `writeCharacterSelectionRows`, the broad
  `replaceAll*` writers, the nine collection tables, `plugin_custom_storage`.
- `server/fastify/src/commands/mutations.ts` - `applyTargetedCommandMutation`,
  `applyCharacterSelectionCommandMutation`.
- `server/fastify/__tests__/commandMetrics.test.ts` - the `mutationPath` review
  gate map and `dbJsonWriteMs` checks.
- `server/fastify/__tests__/commands.test.ts` - the `tableRowidsById`
  rowid-stability assertion (template at lines ~161, ~3269-3284).

## Slices

- [`targeted-writer-kit.md`](slices/phase-0-baseline-foundations/targeted-writer-kit.md) -
  add `writeSettingsOnly`, `writeSingleCharacterRow`, `writeSingleChatRow`,
  `writeSingleCollectionTable` / `writeSingleCollectionRow`,
  `writePluginStorageKey` / `deletePluginStorageKey` to `repository.ts`
  (Prerequisite 1).
- [`targeted-mutation-paths.md`](slices/phase-0-baseline-foundations/targeted-mutation-paths.md) -
  wire the writers into the mutation layer via `applyTargetedCommandMutation`
  (`writeDatabase` off) or bespoke helpers mirroring the reference fix, and
  define the new `mutationPath` labels.
- [`mutation-range-metric-and-gates.md`](slices/phase-0-baseline-foundations/mutation-range-metric-and-gates.md) -
  record the set of tables each route physically writes, capture the
  over-broad baseline, and generalize the `tableRowidsById` /
  `dbJsonWriteMs: 0` review-gate template.
- [`normalization-scope-policy.md`](slices/phase-0-baseline-foundations/normalization-scope-policy.md) -
  codify Prerequisites 2 and 3 as a written contract plus a shared
  "unrelated rows not rewritten" assertion helper.

## Exit Criteria

- The writer kit exists with unit tests proving each writer touches exactly its
  rows and leaves all other rowids stable.
- `applyTargetedCommandMutation` (or a bespoke helper) can carry each narrow
  write with the same revision/event/transaction ordering as the reference fix.
- The mutation-range metric records the written-table set per route, and the
  before-state of the 71 over-broad routes is captured.
- The review-gate template (`dbJsonWriteMs: 0` + rowid-stability) is reusable
  from a single import.
- The normalization-scope policy is written and linked from every tier phase.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
