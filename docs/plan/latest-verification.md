# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: none. This plan was split from the seed audit;
  no remediation has landed.
- Baseline (from the audit, not a fresh run): on a 61 MB hydrated DB, one
  `withTrustedServerProjectionWrite` guarded write takes about 255 ms (entry
  `structuredClone` ~125 ms + refreeze `$state.snapshot` ~130 ms); a few-MB DB is
  tens of ms per call. `currentChatStateSnapshot()` and
  `currentCharacterStateSnapshot()` scale with total hydrated history, not the
  row being mutated. `c9e728b1` already removed the character-select instance.
- Result: not applicable (no change). The pre-existing client/server suites and
  the client-thinning audit are green at the plan's start commit; the reference
  fix's regression tests in `src/ts/compatibilityAdapters.test.ts` pass.

| Command | Result |
| --- | --- |
| `pnpm test` | (baseline, pre-change) - green at plan start. |
| `pnpm api:test` | (baseline, pre-change) - green at plan start. |
| `pnpm client-thinning:audit` | (baseline, pre-change) - green at plan start. |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | (baseline, pre-change) - green at plan start. |

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
