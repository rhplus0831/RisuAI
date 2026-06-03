# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: none yet. This plan was just split from the
  seed audit [`../frontend-performance-audit.md`](../frontend-performance-audit.md);
  no remediation has landed.
- Baseline (from the audit, not a fresh run): on a 61 MB hydrated DB, one
  `withTrustedServerProjectionWrite` guarded write ≈ 255 ms (entry
  `structuredClone` ~125 ms + refreeze `$state.snapshot` ~130 ms); a few-MB DB is
  tens of ms per call. `currentChatStateSnapshot()` /
  `currentCharacterStateSnapshot()` scale with total hydrated history across all
  opened characters, not the single row mutated. The reference fix `c9e728b1`
  already removed the character-select instance (1-3 s sidebar-click freeze).
- Result: not applicable (no change). The pre-existing client/server suites and
  the client-thinning audit are green at the plan's start commit; the reference
  fix's regression tests in `src/ts/compatibilityAdapters.test.ts` pass.

| Command | Result |
| --- | --- |
| `pnpm test` | (baseline, pre-change) — green at plan start. |
| `pnpm api:test` | (baseline, pre-change) — green at plan start. |
| `pnpm client-thinning:audit` | (baseline, pre-change) — green at plan start. |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | (baseline, pre-change) — green at plan start. |

## Notes

- The proof template for each narrowing slice is the reference fix's two tests in
  `src/ts/compatibilityAdapters.test.ts`: (1) the snapshot "captures only scalar
  selection state, never a deep clone of every character"
  (`expect(snapshot).not.toHaveProperty('characters')`) and (2) a failed command
  rolls back only the mutated slice without clobbering an unrelated character's
  `lastInteraction`/`name`. Phase 0 generalizes both into a reusable helper.
- The clone-cost regression gate (Phase 8) asserts each narrowed hot path never
  invokes the whole-`Database` / whole-characters clone primitive; add the gate
  as each slice lands so the narrowing cannot silently regress.
- The guard fix (Phase 1) is verified by a guarded one-field write staying O(1)
  on a multi-chat hydrated DB (no full-DB clone) while Svelte reactivity still
  fires and readers still receive a read-only projection.
- Refresh this file after any new focused or full verification run, recording the
  before/after clone range (the analog of the mutation-range plan's
  before/after written-table set) for the slice under test.
