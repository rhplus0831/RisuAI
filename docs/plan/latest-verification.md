# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 0 foundations only — the narrow snapshot
  kit (`chatCommands.ts`/`characterCommands.ts`/`lorebookBridge.svelte.ts`) and
  the clone-cost harness (`src/ts/__tests__/cloneCostHarness.ts`). No hot-path
  call site is rewired, so no runtime clone range changed yet.
- Before/after clone range: unchanged for every live path. The kit and harness
  exist but are not wired in; Phase 1 (guard) is the first range change. The
  baseline below still holds.
- Baseline (from the audit, not a fresh run): on a 61 MB hydrated DB, one
  `withTrustedServerProjectionWrite` guarded write takes about 255 ms (entry
  `structuredClone` ~125 ms + refreeze `$state.snapshot` ~130 ms); a few-MB DB is
  tens of ms per call. `currentChatStateSnapshot()` and
  `currentCharacterStateSnapshot()` scale with total hydrated history, not the
  row being mutated. `c9e728b1` already removed the character-select instance.
- Result: green. The new Phase 0 kit tests prove (via `withCloneInstrumentation`)
  that `currentCharacterSelectionSnapshot` performs zero whole-characters clones
  while the legacy `currentCharacterStateSnapshot` performs one, and that each new
  snapshot omits the whole collection while each restore rolls back only its slice
  without clobbering concurrent sibling edits.

| Command | Result |
| --- | --- |
| `pnpm test` | green - 975 passed / 4 skipped (102 files). |
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
