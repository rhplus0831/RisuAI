# Latest Verification

Date: 2026-06-04

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 3 cheap wins on top of Phases 0-2, plus
  follow-up guard fix `48d473dc`. Phase 3 includes reroll tail clone + redundant
  dispatch-clone removal + in-place regenerate truncation (`ed4e0af0`) and
  `runTrigger` early-return hoist + lazy whole-character clone (`f4855e24`).
- Before/after clone range: BEFORE = reroll paths cloned whole transcripts before
  slicing/dispatch/truncation, and `runTrigger` cloned the whole character before
  the no-trigger return. AFTER = tail-only clone, by-reference reroll dispatch,
  in-place `applyRerollTruncate`, zero clone for zero-trigger characters,
  active-chat clone for trigger-bearing passes, and a lazy whole-character clone
  only when a data effect installs the character.
- Guard-safety note: reroll regenerate and `runTrigger` installs use in-place
  truncate / lazy deep clone so read-only proxy rows are never re-installed into
  the projection.
- Result: green. Proofs: `rerollNavigation.test.ts`,
  `rerollNavigation.guard.test.ts`, `triggers.cloneCost.test.ts`, and
  `triggers.projectionGuard.test.ts`. The follow-up `setVar`/`v2SetVar` fix routes
  scriptstate sync through `syncActiveChatScriptstate` inside
  `withTrustedServerProjectionWrite`; the guard-on `v2SetVar` test proves no throw
  plus the dispatched `/chats/:id/scriptstate` patch.

| Command                                                                                     | Result                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                 | green - 1003 passed / 4 skipped (105 files).                                                                |
| `pnpm api:test`                                                                             | green - 1632 passed / 1 skipped (93 files).                                                                 |
| `pnpm client-thinning:audit`                                                                | green - audit passed.                                                                                       |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | green - both zero errors (clean client-lib rebuild required: remove `dist/client-types` if TS6305 appears). |

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
