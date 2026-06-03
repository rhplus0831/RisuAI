# Phase 5: Prompt-Template Editor Keystroke Costs

Status: planned. One slice. The whole-DB guard half closes with Phase 1; this
phase closes the template-specific per-keystroke costs.

Goal: stop the prompt-template editor from cloning the whole `promptTemplate`
array and stringifying the whole template twice per keystroke.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the High per-keystroke `promptTemplate` clone and the Medium double-stringify
  change-detection findings; recommended-remediation step 6.
- `src/lib/Setting/Pages/PromptSettings.svelte:196` - `queuePromptItemUpdate`
  (the per-keystroke `cloneJsonValue(promptTemplateDraft.value)` into
  `DBState.db.promptTemplate` inside `withTrustedServerProjectionWrite`).
- `src/lib/Setting/Pages/PromptSettings.svelte:213` - the already-250ms-debounced
  server command (the timer to coalesce into).
- `src/lib/Setting/Pages/PromptSettings.svelte:358` - the change-detection
  `$effect` doing two `snapshotJson` passes (server + draft) per flush.
- `src/ts/server/commands.ts` - `cachedServerCommandRevision` (the discriminator).
- `src/lib/UI/PromptDataItem.svelte:49` - the per-keystroke single-PromptItem
  stringify + double `clonePromptItem` (bounded, low - co-fix here).

## Slices

- [`prompt-template-keystroke-costs.md`](slices/phase-5-prompt-template-keystroke/prompt-template-keystroke-costs.md) -
  debounce the optimistic projection write, mutate only the edited item, and
  replace double-stringify change detection with a server-revision discriminator.

## Exit Criteria

- [ ] A keystroke in a prompt-item textarea no longer clones the whole
  `promptTemplate` array (only the edited item) and no longer runs two
  whole-template `JSON.stringify` passes.
- [ ] The optimistic write coalesces into the debounce window; the server still
  receives the same final patch; external server pushes still reconcile into the
  draft.
- [ ] Editing remains correct (draft <-> server reconciliation unchanged on a real
  revision advance); `pnpm test` is green.

## Validation

- `pnpm test -- src/lib/Setting/Pages/PromptSettings` (or the settings suite)
- `pnpm test`
- `pnpm client-thinning:audit`
