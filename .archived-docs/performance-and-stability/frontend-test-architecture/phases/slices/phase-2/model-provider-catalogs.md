# Phase 2 Slice: Model Provider Catalogs

Status: Complete

## Scope

Promote these existing model discovery, credential-routing, cache, and
data-shaping suites from the Happy-DOM fallback to the explicit Node inventory
without changing their test bodies or production subjects:

- `src/ts/model/modellist.dynamic.test.ts`
- `src/ts/model/nanogpt.test.ts`
- `src/ts/model/ollama.test.ts`
- `src/ts/model/openrouter.test.ts`

The four files contain 25 expanded tests. They move from D to N ownership as
one `client-model` slice. Adjacent model profile resolver/UI-state suites retain
their Svelte+Node target classification for Phase 3.

## Source Anchors And Dependencies

- `modellist.dynamic.test.ts` mocks database, provider-operation, plugin, and
  plugin-v3 boundaries before importing the model registry. The subject's
  remaining `svelte/store` import is a plain runtime package import and passed
  without Svelte transformation; the suite cleans up its two mutable dynamic
  model ids before and after every case.
- `nanogpt.test.ts` and `openrouter.test.ts` mock the Svelte-named database
  accessor and the complete provider-operation boundary. Their remaining
  runtime graphs are ordinary TypeScript mapping plus `keyedRequestCache.ts`.
- `ollama.test.ts` mocks both the Svelte-named global fetch boundary and the
  provider-operation boundary. Its local-network branch asserts the injected
  `ollama_models` interceptor rather than performing a request.
- The three provider adapters share a plain TypeScript keyed-request cache that
  coalesces active requests, briefly retains successful results, isolates
  complete request contexts, and removes rejected work.
- No suite mounts a component, accesses DOM/browser storage, performs a real
  network request, or relies on Happy-DOM setup. No mock was added or weakened
  for promotion.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.

## Behavior Invariants

- Dynamic Google/Anthropic discovery retains fixed operation ordering,
  credential selection, generation-method filtering, mapped model identity,
  and preservation of newer selected model fields after late discovery.
- NanoGPT retains global, profile, supplied, and intentional-public credential
  contexts; same-context coalescing and short result reuse; changed-key
  isolation; failure retry; pay-as-you-go routing; account/provider-detail
  operation names; and catalog field/price mapping.
- Ollama retains same-key cloud coalescing, changed-key isolation, refresh for
  opaque stored credentials, and separation between cloud provider operations
  and local-network discovery.
- OpenRouter retains global, supplied, profile, and intentional-public
  credential contexts; model/provider sorting and pricing conversion; optional
  price handling; cache coalescing, refresh, and changed-key isolation; failure
  retry; and empty free-catalog fallback.
- No rendered UI, browser storage, browser navigation, or network contract
  changes ownership.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their
focused run changed from 1.36s wall / 474ms Vitest / 452,412 KiB peak RSS /
550ms aggregate environment time in D to 0.98s / 294ms / 353,132 KiB / 0ms in
N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 141 N / 2 S / 386 D to 145 N / 2 S / 382 D. Wall time changed
from 70.52s to 73.19s (+2.67s, +3.8%), Vitest duration changed from 69.54s to
72.11s, and peak RSS changed from 4,768,944 KiB to 4,784,356 KiB (+0.3%). The
paired DOM project fell from 70.45s to 67.69s while the Node project changed
from 4.54s to 4.72s.

The ordinary wall movement remains within observed lane variability, while the
owning DOM project and focused execution both improved. This is a single paired
slice observation, not a phase-level timing claim.

## Validation

- The pre-promotion focused Happy-DOM run passed 4 files / 25 tests.
- The focused `frontend-node` probe passed 4 files / 25 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 146 N / 2 S /
  389 D, standalone ordinary ownership at 146 N / 2 S / 387 D, and aggregate
  ordinary ownership at 145 N / 2 S / 382 D.
- Complete standalone Node and DOM project runs, `pnpm test:frontend`, the
  selected affected-test plan, formatting, and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed in this promotion, so the periodic Phase 2 `test:all` checkpoint
  remains satisfied by the test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All four target-project probes and repeated owning-run executions pass.
- The generated inventory removes all four target-N probe markers.
- File and test totals are unchanged, and browser-shaped contracts remain in D.
- The paired ordinary lane does not establish a material regression.

## Rollback

Remove the four paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, or setup rollback is required.
