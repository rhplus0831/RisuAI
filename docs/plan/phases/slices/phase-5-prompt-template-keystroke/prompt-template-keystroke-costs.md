# Prompt-Template Keystroke Costs

Status: planned. Phase 5. The whole-DB guard half closes with Phase 1.

## Scope

Stop prompt-template editing from cloning the whole `promptTemplate` array and
double-stringifying it on each keystroke.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High per-keystroke `promptTemplate` clone and the Medium double-stringify
  findings; the Low `PromptDataItem` finding.
- `src/lib/Setting/Pages/PromptSettings.svelte:196` - `queuePromptItemUpdate` (the
  per-keystroke `cloneJsonValue(promptTemplateDraft.value)` write inside
  `withTrustedServerProjectionWrite`; `index` already computed at `:198`).
- `src/lib/Setting/Pages/PromptSettings.svelte:200-202/213` - the optimistic write
  vs the already-250ms-debounced server command.
- `src/lib/Setting/Pages/PromptSettings.svelte:358` - the change-detection
  `$effect` (two `snapshotJson` passes per flush; tracks both
  `DBState.db.promptTemplate` and `promptTemplateDraft.value`).
- `src/ts/server/commands.ts` - `cachedServerCommandRevision`.
- `src/lib/UI/PromptDataItem.svelte:49` - the per-keystroke single-PromptItem
  stringify + double `clonePromptItem` (bounded; optional co-fix).

## Target Implementation

1. Debounce the projection write. Coalesce the optimistic write into the existing
   250 ms server-command timer.
2. Mutate only the edited item. Inside the guarded write, set
   `DBState.db.promptTemplate[index] = cloneJsonValue(promptItem)` (the `index` is
   already computed) instead of replacing the whole array.
3. Cheap change detection. Replace the double `JSON.stringify` at `:358` with a
   server-revision discriminator. Only re-pull `serverValue` when
   `cachedServerCommandRevision` advances. A pure reference check will not work
   because `queuePromptItemUpdate` reassigns `DBState.db.promptTemplate`.
4. (Optional) `PromptDataItem.svelte:49`: drop one of the two `clonePromptItem`
   passes; bounded, low.

## Behavior / Invariants

- The server still receives the same final patch (the debounced command is
  unchanged).
- An external server push still reconciles into the draft on a real revision
  advance.
- Edited template content is byte-identical.

## Done When

- A keystroke clones only the edited item (not the whole array) and runs zero
  whole-template `JSON.stringify` passes; the guarded write fires at most once per
  idle window (clone-cost harness + a debounce assertion).
- Draft <-> server reconciliation still works on a revision advance.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/lib/Setting/Pages/PromptSettings` (or the settings suite)
- `pnpm test`
- `pnpm client-thinning:audit`
