# Phase 3: Cheap High-Confidence Wins

Status: planned. One slice. Independent of the Phase 0 snapshot kit; can land
alongside Phase 1.

Goal: land small behavior-preserving clone wins: reroll clone reorder/removal and
`runTrigger` early return before cloning. No snapshot API changes.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the `recordGeneratedReroll`, reroll-redundant-clone, and `runTrigger`
  clone-before-early-return findings; recommended-remediation step 4.
- `src/ts/process/rerollNavigation.svelte.ts:60` - `recordGeneratedReroll`
  (`safeStructuredClone(message).slice(previousLength)`).
- `src/ts/process/rerollNavigation.svelte.ts:105/147` - the redundant
  `safeStructuredClone(record.message)` (the dispatch re-clones) and the full
  transcript clone in `reroll()`.
- `src/ts/process/triggers.ts:1198` - `runTrigger` `safeStructuredClone(char)` +
  `safeStructuredClone(chat)` before the `triggers.length === 0` early return.

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

- `pnpm test -- src/ts/process/rerollNavigation` (or the reroll suite)
- `pnpm test -- src/ts/process/triggers` (or the triggers suite)
- `pnpm test`
- `pnpm client-thinning:audit`
