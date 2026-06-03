# Phase 3: Cheap High-Confidence Wins

Status: planned. One slice. Independent of the Phase 0 snapshot kit; ready to
land next.

Goal: land small behavior-preserving clone wins: reroll clone reorder/removal and
`runTrigger` early return before cloning. No snapshot API changes.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the `recordGeneratedReroll`, reroll-redundant-clone, and `runTrigger`
  clone-before-early-return findings; recommended-remediation step 4.
- `src/ts/process/rerollNavigation.svelte.ts` - `recordGeneratedReroll`, the
  redundant `safeStructuredClone(record.message)`, and the full-transcript clone
  in `reroll()`.
- `src/ts/process/triggers.ts` - `runTrigger` clones `char` / active `chat`
  before the `triggers.length === 0` early return.

## Slices

- [`cheap-clone-wins.md`](slices/phase-3-cheap-wins/cheap-clone-wins.md) -
  clone only the reroll tail, remove redundant reroll dispatch clones, and hoist
  `runTrigger`'s no-trigger return above char/chat clones.

## Exit Criteria

- [ ] `recordGeneratedReroll` clones O(tail) not O(transcript); the stored reroll
      is byte-identical.
- [ ] The redundant `:105` clone is removed and `reroll()` no longer clones the
      whole transcript when only the trailing group is reshaped; dispatch payloads are
      unchanged.
- [ ] A zero-trigger character pays no `char`/`chat` clone in `runTrigger`;
      trigger-bearing paths clone only the active chat once.
- [ ] Trigger results, reroll navigation, and persisted messages are
      byte-identical; `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.rollback.test.ts src/ts/process/rerollNavigation.guard.test.ts`
- `pnpm test -- src/ts/process/__tests__/triggers.projectionGuard.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
