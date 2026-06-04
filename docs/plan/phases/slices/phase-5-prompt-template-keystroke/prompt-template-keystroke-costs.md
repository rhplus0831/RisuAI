# Prompt-Template Keystroke Costs

Status: planned. Phase 5. The whole-DB guard half closed in Phase 1.

## Scope

Stop prompt-template editing from cloning the whole `promptTemplate` array and
double-stringifying it on each keystroke.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High per-keystroke `promptTemplate` clone and the Medium double-stringify
  findings; the Low `PromptDataItem` finding.
- `src/lib/Setting/Pages/PromptSettings.svelte` - `queuePromptItemUpdate`, the
  optimistic write, the already-250ms-debounced server command, and the
  change-detection `$effect`.
- `src/ts/server/commands.ts` - `peekCachedServerCommandRevision()`.
- `src/lib/UI/PromptDataItem.svelte` - the per-keystroke single-PromptItem
  stringify + double `clonePromptItem` (bounded; optional co-fix).

## Target Implementation

1. Debounce the projection write. Coalesce the optimistic write into the existing
   250 ms server-command timer.
2. Mutate only the edited item. Inside the guarded write, set
   `DBState.db.promptTemplate[index] = cloneJsonValue(promptItem)` (the `index` is
   already computed) instead of replacing the whole array.
3. Cheap change detection. Replace the double whole-template `JSON.stringify`
   with the exported server-revision discriminator
   (`peekCachedServerCommandRevision()`). Only re-pull `serverValue` when that
   revision advances. A pure reference check will not work because
   `queuePromptItemUpdate` reassigns `DBState.db.promptTemplate`.
4. (Optional) `PromptDataItem.svelte`: drop one of the two `clonePromptItem`
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

- Add focused tests for `PromptSettings.svelte` / `PromptDataItem.svelte` behavior
  touched by the slice.
- `pnpm test`
- `pnpm client-thinning:audit`
