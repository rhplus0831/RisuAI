# Prompt-Template Keystroke Costs

Status: implemented (`c5fc5967` + `64804305`). Phase 5. The whole-DB guard half
closed in Phase 1.

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

## Implemented Shape

- `applyPromptItemProjectionWrite` writes one prompt item in place, and
  `restorePromptItemProjectionWrite` restores one item on command failure. A full
  sync remains only as the missing-row fallback.
- `reconcilePromptTemplateDraft` uses `peekCachedServerCommandRevision()` as the
  discriminator, so ordinary keystrokes run zero whole-template stringify passes.
- `PromptDataItem.svelte` clones the edited item once per change instead of
  twice.
- Deferred: coalescing the synchronous optimistic write into the existing 250 ms
  server-command debounce window.

## Behavior / Invariants

- The server still receives the same final patch (the debounced command is
  unchanged).
- An external server push still reconciles into the draft on a real revision
  advance.
- Edited template content is byte-identical.

## Done When (met, except the deferred debounce)

- A keystroke clones only the edited item (not the whole array) and runs zero
  whole-template `JSON.stringify` passes (clone-cost harness in
  `promptTemplateBridge.svelte.test.ts`). The guarded write firing "at most once
  per idle window" is the deferred coalescing (step 1); the write is still
  per-keystroke but now O(1) + one-item clone.
- Draft <-> server reconciliation still works on a revision advance.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/server/promptTemplateBridge.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
