# Phase 2 Slice: Chat-Generation Toggle Presets Node Probe

Status: Complete without promotion

## Scope And Boundary

Evaluate `src/ts/chatGenerationTogglePresets.test.ts` for Node promotion. The
five tests cover saved-toggle normalization, similarity, deterministic best
matching, cloning, and fallback selection. They have no direct DOM assertion,
but the unchanged production graph imports both Svelte runes and an eager
browser-global read.

No production module, test body, mock, assertion, or permanent runtime
inventory changes in this proof batch. Extracting the pure helpers from their
browser-shaped entry graph belongs to Phase 4, not Phase 2.

## Probe Result

- The current Happy-DOM owner passed 1 file / 5 tests in 3.87s wall and 3.17s
  Vitest duration, with 673,244 KiB peak RSS and 104ms environment time.
- The temporary Node probe failed before collection with `$state is not
  defined` at `stores/coreStores.svelte.ts:5`, reached through `alert.ts` and
  `storage/fastifyStorage.ts`. It took 1.19s wall and 549ms Vitest duration,
  with 413,952 KiB peak RSS and no environment time.
- The temporary Svelte+Node classification probe passed the rune boundary but
  failed before collection with `window is not defined` at
  `stores.svelte.ts:23`, reached through `chatCommands.ts` and
  `activeChatGenerationSettings.ts`. It took 1.60s wall and 981ms Vitest
  duration, with 458,124 KiB peak RSS and 16ms environment time.

Both temporary entries were removed. The suite remains D-owned because D is
the smallest current runtime capable of loading its unchanged subject graph.

## Validation And Deferral

- The current owner passed all five tests; the exact N and S probes failed for
  distinct recorded import-graph requirements.
- `pnpm check:frontend-test-inventory` retained exhaustive and disjoint full,
  standalone ordinary, and aggregate ordinary discovery.
- Formatting of changed files and `git diff --check` passed.

Owner: Phase 4 client-core pure-logic extraction. Reason: the assertions are
pure but their entry graph eagerly requires both Svelte transformation and
`window`. Revisit only with a measured extraction that preserves these five
oracles and retains an owning browser-shaped contract.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

No runtime rollback is required. Replace this proof only with fresher target
runtime evidence after a relevant import-graph or extraction change.
