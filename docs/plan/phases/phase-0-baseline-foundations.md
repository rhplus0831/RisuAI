# Phase 0: Baseline Foundations

Status: implemented (2026-06-03). All four slices have landed; no route was
narrowed (that starts in Phase 1).

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

- [x] The writer kit exists with unit tests
  (`__tests__/repositoryWriterKit.test.ts`) proving each writer touches exactly
  its rows and leaves all other rowids stable.
- [x] `applyTargetedCommandMutation` carries each narrow write (via
  `TARGETED_MUTATION_PATHS` + the kit) with the same single revision bump / single
  event / atomic-rollback ordering as the reference fix
  (`__tests__/targetedMutationPaths.test.ts`).
- [x] The mutation-range metric records the written-table set
  (`writtenTables`) per route, and the before-state of the 71 over-broad routes
  is captured (the Measurement table in the metric slice).
- [x] The review-gate template (`dbJsonWriteMs: 0` + expected/forbidden table
  sets) is reusable from a single import
  (`__tests__/helpers/commandMetricGates.ts`), with the rowid-stability
  primitives in `__tests__/helpers/rowStability.ts`.
- [x] The normalization-scope policy is written and linked from every tier phase
  (Phases 2-4), and `assertOnlyRowsWritten` is in use.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
