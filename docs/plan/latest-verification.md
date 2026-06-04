# Latest Verification

Date: 2026-06-04

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 3 cheap wins COMPLETE — reroll post-send
  tail clone + redundant dispatch-clone removal + in-place regenerate truncation
  (`ed4e0af0`), and `runTrigger` early-return hoist + lazy whole-character clone
  (`f4855e24`), on top of Phases 0-2.
- Before/after clone range for the narrowed hot paths: BEFORE = `recordGeneratedReroll`
  deep-cloned the whole transcript then sliced; `applyTailSlice` deep-cloned the
  whole transcript again for the dispatch (redundant with `toMessageSnapshot`);
  `reroll()` deep-cloned the whole transcript to pop a 1-2 message tail;
  `runTrigger` deep-cloned the whole character (every other chat's full history)
  on every non-display pass, before the no-trigger early return. AFTER = a
  tail-only clone (`message.slice(previousLength)`), a by-reference dispatch (ids
  minted inside the write guard), an in-place live-transcript truncation
  (`applyRerollTruncate`, surviving rows reused), and — for `runTrigger` — zero
  clone for a zero-trigger character, the active-chat clone only for a
  trigger-bearing pass, and a lazy single whole-character clone paid only when a
  data effect installs the character.
- Guard-safety note: the reroll regenerate and the `runTrigger` install paths use
  guard-safe shapes (in-place truncate; lazy deep clone) rather than the naive
  shallow copy the audit sketched, because the read-only projection re-installs the
  mutated object — a shallow copy would have stored read-only proxy rows back into
  the projection and poisoned later writes.
- Result: green. New clone-cost + guard proofs: `rerollNavigation.test.ts`
  "reroll clone cost (Phase 3)" (tail-only post-send clone; in-place regenerate
  truncate stays below the transcript), `rerollNavigation.guard.test.ts` "reroll
  regenerate truncates the frozen transcript in place without throwing", and
  `triggers.cloneCost.test.ts` (zero-trigger pays no clone; a `setVar` trigger
  clones only the active chat). The `runTrigger` install effects stay covered by
  `triggers.projectionGuard.test.ts` (8 tests green with the lazy clone).
- Follow-up fix (`48d473dc`): `setVar`/`v2SetVar` previously wrote scriptstate
  directly to the read-only projection (`triggers.ts:1402-1404`), so a client
  `manual`/slash `setVar` trigger threw under the guard (pre-existing, surfaced by
  the Phase 3 clone-cost test). Now routed through `syncActiveChatScriptstate`
  (`withTrustedServerProjectionWrite` + `getCurrentChat()` re-read); a guard-on
  `v2SetVar` test in `triggers.projectionGuard.test.ts` proves no throw + the
  dispatched `/chats/:id/scriptstate` patch. Client suite now 1003 / 4 skipped.

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
