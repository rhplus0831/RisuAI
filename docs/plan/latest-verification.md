# Latest Verification

Date: 2026-06-04

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 2 snapshot-family hot-path narrowing
  COMPLETE (final three slices: reroll/swipe rollback `f1558e39`, character-row
  snapshot paths `458458a7`, global-lorebook + lorebook-trigger rollback
  `9547ba3e`), on top of the Phase 0 kit, the Phase 1 guard, and the first three
  Phase 2 slices.
- Before/after rollback-clone range for the narrowed hot paths: BEFORE = a
  whole-`characters` (and, for lorebook, `characters` + `modules`) JSON deep clone
  per swipe / character-field edit / global-lorebook select / lorebook-trigger
  fire — scales with total hydrated history. AFTER = a single active-chat clone
  (reroll/swipe), a single character-row clone (`setCurrentCharacter` /
  `setCharacterByIndex`), `loreBook`/`loreBookPage` only (global-lorebook
  select/create/delete), and a single character's `globalLore` (the 6 v2 lorebook
  triggers, which also drop the redundant `setCurrentCharacter` re-clone + the
  per-trigger `ensureAllClientLorebookIds` full-tree walk).
- Result: green. New rollback-correctness + clone-cost proofs:
  `rerollNavigation.rollback.test.ts` (a swipe never serializes the large sibling
  transcript; a failed `dispatchReplaceMessagesScoped` restores only the active
  chat), `characterCommands.test.ts` "Phase 2 character-row scoped dispatch",
  `lorebookBridge.test.ts` "Phase 2 global-lorebook scoped dispatch", and
  `triggers.projectionGuard.test.ts` "Phase 2 trigger lorebook scoped rollback".

| Command                                                                                     | Result                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                 | green - 997 passed / 4 skipped (104 files).                                                                 |
| `pnpm api:test`                                                                             | green - 1632 passed / 1 skipped (93 files).                                                                 |
| `pnpm client-thinning:audit`                                                                | green - audit passed.                                                                                       |
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
