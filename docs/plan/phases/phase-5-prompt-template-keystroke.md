# Phase 5: Prompt-Template Editor Keystroke Costs

Status: implemented (`c5fc5967` + `64804305`). One slice. The whole-DB guard half
closed in Phase 1; this phase closes the template-specific per-keystroke costs.

Goal: stop the prompt-template editor from cloning the whole `promptTemplate`
array and stringifying the whole template twice per keystroke.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the High per-keystroke `promptTemplate` clone and the Medium double-stringify
  change-detection findings; recommended-remediation step 6.
- `src/lib/Setting/Pages/PromptSettings.svelte` - `queuePromptItemUpdate`, the
  already-250ms-debounced server command, and the change-detection `$effect`.
- `src/ts/server/commands.ts` - `peekCachedServerCommandRevision()` (the exported
  revision discriminator).
- `src/lib/UI/PromptDataItem.svelte` - the per-keystroke single-PromptItem
  stringify + double `clonePromptItem` (bounded, low - co-fix here).

## Slices

- [`prompt-template-keystroke-costs.md`](slices/phase-5-prompt-template-keystroke/prompt-template-keystroke-costs.md) -
  debounce the optimistic projection write, mutate only the edited item, and
  replace double-stringify change detection with a server-revision discriminator.

## Exit Criteria

- [x] A keystroke in a prompt-item textarea no longer clones the whole
      `promptTemplate` array (only the edited item) and no longer runs two
      whole-template `JSON.stringify` passes. `queuePromptItemUpdate` now calls
      `applyPromptItemProjectionWrite` (one in-place item write), and the
      change-detection effect calls `reconcilePromptTemplateDraft` (revision
      discriminator, zero stringify when the revision is unchanged).
- [~] The server still receives the same final patch and external server pushes
      still reconcile into the draft. The optimistic projection write is **not**
      coalesced into the debounce window — it stays synchronous (one narrowed
      in-place write per keystroke). See the deferral note below.
- [x] Editing remains correct (draft <-> server reconciliation unchanged on a real
      revision advance); `pnpm test` is green.

## Deferred

Coalescing the optimistic projection write into the 250 ms debounce window
(slice step 1) is deferred. The dominant cost — the per-keystroke whole-array
clone — is eliminated by the in-place write (step 2), and after Phase 1 the
guarded write itself is O(1), so coalescing only saves the per-keystroke guard
wrap. Keeping the write synchronous preserves the projection as authoritative for
`templateCheck` warns and for the revision-gated reconcile with no timing change,
which is why this lower-value, higher-risk sub-step is left for later.

## Outcome

The hot-path logic moved to `src/ts/server/promptTemplateBridge.svelte.ts`
(`applyPromptItemProjectionWrite`, `restorePromptItemProjectionWrite`,
`reconcilePromptTemplateDraft`) so it is testable in isolation. A keystroke now
clones one prompt item, the failed-command rollback restores one item, and the
change detection runs a whole-template stringify only on a real revision advance.
`PromptDataItem.svelte` also clones the edited item once per change instead of
twice (the co-located Low finding). Proven by
`promptTemplateBridge.svelte.test.ts` (7 tests: single-item clone cost, scoped
rollback, and the revision-gated reconcile branches).

## Validation

- `pnpm test -- src/ts/server/promptTemplateBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
