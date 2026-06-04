# Latest Verification

Date: 2026-06-04

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 5 prompt-template editor keystroke
  narrowing (`c5fc5967` + `64804305`) on top of Phases 0-4.
- Before/after clone range: BEFORE = each prompt-item keystroke cloned the whole
  `promptTemplate` array into the projection (`DBState.db.promptTemplate =
  clone(draft)`), the failed-command rollback cloned the whole array again, the
  change-detection `$effect` ran two whole-template `JSON.stringify` passes per
  reactive fire, and `PromptDataItem` cloned the edited item twice per change.
  AFTER = `applyPromptItemProjectionWrite` writes one item in place (find-by-id),
  `restorePromptItemProjectionWrite` rolls back one item, and
  `reconcilePromptTemplateDraft` gates reconciliation on the cached command
  revision (`peekCachedServerCommandRevision`), so a keystroke runs zero
  whole-template stringify passes; `PromptDataItem` clones once per change.
- Guard-safety / behavior note: the optimistic projection write stays synchronous
  (kept authoritative for `templateCheck` warns and the revision-gated reconcile);
  coalescing it into the 250 ms debounce window is deferred. The full-array sync
  remains as a fallback only when the projection has no row for the edited id yet.
  The server still receives the same final patch, and an external push still
  reconciles into the draft on a real revision advance.
- Result: green. Proofs added in `promptTemplateBridge.svelte.test.ts` (7 tests):
  single-item clone cost (`maxClonedSize` below the multi-item array of large
  bodies), the scoped rollback (unrelated items untouched), and the revision-gated
  reconcile (zero stringify when the revision is unchanged; reconcile only on a
  revision advance with differing content).

| Command                                                                                     | Result                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                 | green - 1015 passed / 4 skipped (106 files).                                                                |
| `pnpm api:test`                                                                             | green - 1632 passed / 1 skipped (93 files).                                                                 |
| `pnpm client-thinning:audit`                                                                | green - audit passed.                                                                                       |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | green - both zero errors (clean client-lib rebuild required: remove `dist/client-types` AND `tsconfig.client-lib.tsbuildinfo` if TS6305 appears). |
| `pnpm check` (svelte-check)                                                                  | 10 pre-existing errors in 5 files outside this workstream (unchanged baseline); the Phase 5 files add none. |

## Notes

- The proof template is `src/ts/compatibilityAdapters.test.ts`: snapshot omits
  `characters`, and failed commands roll back only the mutated slice. Phase 0
  turns this into a reusable helper.
- Phase 8 keeps the clone-cost gate map self-checking: each narrowed hot path
  should have a proof that it avoids whole-`Database` / whole-characters clone
  primitives, and new slices should add that proof before being marked
  implemented.
- The guard fix (Phase 1) is verified by a guarded one-field write staying O(1)
  on a multi-chat hydrated DB (no full-DB clone) while Svelte reactivity still
  fires and readers still receive a read-only projection.
- Refresh this file after any new focused or full verification run, recording the
  before/after clone range (the analog of the mutation-range plan's
  before/after written-table set) for the slice under test.
