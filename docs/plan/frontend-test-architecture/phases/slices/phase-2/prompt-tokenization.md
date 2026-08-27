# Phase 2 Slice: Prompt Conversion And Tokenization

Status: Complete

## Scope

Promote these existing prompt conversion, prompt tokenization, and tokenizer
selection/cache suites from the Happy-DOM fallback to the explicit Node
inventory without changing their test bodies or production subjects:

- `src/ts/process/prompt.conversionDurability.test.ts`
- `src/ts/process/promptTokenizeMemo.test.ts`
- `src/ts/tokenizer.test.ts`

The three files contain 16 expanded tests. They move from D to N ownership as
one prompt/tokenization slice. Prompt assembly and translator suites with
direct Svelte-store or rendered-DOM evidence retain their Phase 3 or D
classification.

## Source Anchors And Dependencies

- `prompt.conversionDurability.test.ts` replaces the Svelte-named preset
  persistence boundary, tokenizer, and alert surface before importing
  `prompt.ts`. Its remaining exercised graph is JSON conversion, preset data
  shaping, localization lookup, and durable outcome handling.
- `promptTokenizeMemo.test.ts` replaces the same storage and alert boundaries
  plus the tokenizer. Its debounce cases use Vitest fake timers explicitly;
  its remaining behavior is plain TypeScript cache-key construction, token
  aggregation, invalidation, and stale-result fencing.
- `tokenizer.test.ts` replaces the Svelte-named database, plugin, parser, and
  global-fetch boundaries as well as local tokenization and provider
  operations. It exercises the injected Google count-token operation, bounded
  cache behavior, and the dependency-free Fastify tokenizer option catalog.
  Browser-only fetch and local-storage branches are not reached by these
  contracts.
- Type-only imports from Svelte-named modules are erased. The target-project
  probe confirmed that the remaining runtime imports require neither Svelte
  transformation nor browser globals.
- No suite mounts a component, accesses DOM/browser storage, performs a real
  network request, or relies on Happy-DOM setup. No mock was added or weakened
  for promotion.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.

## Behavior Invariants

- Prompt conversion still rejects empty and unsupported inputs without a
  write, maps supported ST Chat fields into the persisted preset, waits for the
  durable outcome, and reports applied, queued, and failed outcomes through the
  correct notice surface.
- Prompt token totals still match the non-memoized implementation across all
  supported prompt item types, treat absent templates as zero, reuse only
  matching entries, and evict deleted entries.
- Prompt-token debounce still publishes only the latest edit, fences stale
  in-flight work, contains failures, and continues after an error.
- Google Cloud token counting still preserves collision-safe model/text cache
  keys, bounded oldest-entry eviction, and provider-operation credential and
  input routing.
- The portable Fastify tokenizer option catalog remains complete and ordered.
- No rendered UI, browser storage, browser navigation, or real-network
  contract changes ownership.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their
focused run changed from 1.39s wall / 596ms Vitest / 491,152 KiB peak RSS /
479ms aggregate environment time in D to 1.16s / 398ms / 436,736 KiB / 0ms in
N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 145 N / 2 S / 382 D to 148 N / 2 S / 379 D. Wall time changed
from 69.32s to 70.17s (+0.85s, +1.2%), Vitest duration changed from 68.44s to
69.27s, and peak RSS changed from 5,009,748 KiB to 4,957,828 KiB (-1.0%). The
paired DOM project changed from 68.19s to 68.61s while the Node project changed
from 4.39s to 4.27s.

The ordinary and DOM wall movements remain within observed lane variability,
while focused execution and peak RSS improved. This is a single paired slice
observation, not a phase-level timing claim.

## Validation

- The pre-promotion focused Happy-DOM run passed 3 files / 16 tests.
- The focused `frontend-node` probe passed 3 files / 16 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 149 N / 2 S /
  386 D, standalone ordinary ownership at 149 N / 2 S / 384 D, and aggregate
  ordinary ownership at 148 N / 2 S / 379 D.
- Complete standalone Node and DOM project runs, `pnpm test:frontend`, the
  selected affected-test plan, formatting, and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed in this promotion, so the periodic Phase 2 `test:all` checkpoint
  remains satisfied by the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All three target-project probes and repeated owning-run executions pass.
- The generated inventory removes all three target-N probe markers.
- File and test totals are unchanged, and browser-shaped contracts remain in D.
- The paired ordinary lane does not establish a material regression.

## Rollback

Remove the three paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
