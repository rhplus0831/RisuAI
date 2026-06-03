# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 1 copy-on-write projection write guard
  (`src/ts/server/projectionWriteGuard.svelte.ts`), on top of the Phase 0 kit +
  harness. This is the first runtime clone-range change.
- Before/after clone range for a guarded write: BEFORE = two whole-`Database`
  deep clones per top-level guarded write (entry `structuredClone(source)` +
  refreeze `$state.snapshot`), ~255 ms on a 61 MB DB. AFTER = zero clones; entry
  hands the callback a writable pass-through working copy and refreeze re-wraps
  the same mutated source in a fresh read-only proxy tree (per-wrap memo keeps
  reactivity). O(1) regardless of DB size. The rare full-projection-replacement
  apply path still does one `$state.snapshot` unwrap (unchanged).
- Snapshot-family hot paths (Phase 2) still clone whole collections; unchanged
  this run.
- Result: green. `projectionWriteGuard.test.ts` proves a guarded one-field write
  performs `structuredCloneCount === 0` and `maxClonedSize` below the characters
  size, stays read-only after the write, mints a fresh identity per write, nests
  correctly, and supports the apply path. `chatMessageHydration.reactivity.svelte.test.ts`
  guards that nested `$derived` chains still re-run (the per-wrap-memo fix).

| Command | Result |
| --- | --- |
| `pnpm test` | green - 982 passed / 4 skipped (103 files). |
| `pnpm api:test` | green - 1632 passed / 1 skipped (93 files). |
| `pnpm client-thinning:audit` | green - audit passed. |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | green - both zero errors (clean client-lib rebuild required: remove `dist/client-types` if TS6305 appears). |

## Notes

- The proof template is `src/ts/compatibilityAdapters.test.ts`: snapshot omits
  `characters`, and failed commands roll back only the mutated slice. Phase 0
  turns this into a reusable helper.
- The clone-cost regression gate (Phase 8) asserts each narrowed hot path never
  invokes the whole-`Database` / whole-characters clone primitive; add the gate
  as each slice lands so the narrowing cannot silently regress.
- The guard fix (Phase 1) is verified by a guarded one-field write staying O(1)
  on a multi-chat hydrated DB (no full-DB clone) while Svelte reactivity still
  fires and readers still receive a read-only projection.
- Refresh this file after any new focused or full verification run, recording the
  before/after clone range (the analog of the mutation-range plan's
  before/after written-table set) for the slice under test.
