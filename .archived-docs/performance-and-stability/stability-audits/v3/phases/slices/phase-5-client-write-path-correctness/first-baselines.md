# Slice: First Baselines

Phase: [5](../../phase-5-client-write-path-correctness.md). Findings: L25
and L27. Client rollback-baseline correctness change.

## Scope

Keep the true first pre-edit baseline across coalesced edits in the same
debounce window. If a command later fails, rollback must restore the state from
before typing began, not an intermediate mid-typing state.

This slice owns prompt-template same-item coalescing and lorebook entry-draft
coalescing. It does not change command schemas, debounce durations, or
unrelated bridge flush behavior.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L25 and L27.
- `src/lib/Setting/Pages/PromptSettings.svelte`:
  `queuePromptItemUpdate` and prompt item update handlers.
- `src/lib/UI/PromptDataItem.svelte`: prompt item edit surface.
- `src/ts/server/promptTemplateBridge.svelte.ts` and
  `src/ts/server/promptTemplateBridge.svelte.test.ts`: prompt-template command
  behavior and rollback tests.
- `src/ts/server/scriptDefinitionBridge.svelte.ts`: existing
  `existing?.previous ?? previous` precedent for coalesced same-key edits.
- `src/ts/server/settingsBridge.svelte.ts`: existing first-baseline precedent.
- `src/ts/server/lorebookBridge.svelte.ts`:
  `applyLorebookEntryDraftEdit`, `queueReplacement`,
  `currentLorebookCollectionScopedSnapshot`, and entry-draft flush state.
- `src/ts/server/lorebookBridge.svelte.test.ts`: K4 draft-edit tests and
  watcher rollback-baseline tests.

## Target Shape

- In prompt-template pending update state, preserve the first previous value
  with the established `existing?.previous ?? previous` shape, or an
  equivalent helper that cannot be overwritten by later same-item edits.
- Add a prompt-template test that edits the same item twice within one debounce
  window, fails the command, and proves rollback restores the original item.
- In lorebook entry-draft pending state, keep the entry-level lightweight
  snapshot for the first edit.
- If a second entry edit lands for the same scoped lorebook collection before
  the debounce dispatch, promote the pending rollback to a collection snapshot
  from `currentLorebookCollectionScopedSnapshot`.
- Ensure the promoted collection snapshot is still the first pre-edit
  collection baseline, not a collection snapshot captured after the first
  optimistic entry mutation.
- Keep the existing low-clone K4 behavior for a single entry edit; collection
  snapshot promotion is only for coalesced edits that need collection-level
  rollback correctness.
- Register L25 and L27 as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- First edit in a debounce window captures the rollback baseline.
- Later same-item prompt-template edits never replace that baseline.
- A single lorebook entry edit still avoids a full collection clone.
- Multiple lorebook entry edits in the same debounce window roll back the full
  collection to the original pre-edit state.
- Mid-typing optimistic values must never become rollback baselines.

## Done Criteria

- Coalesced prompt-template edits roll back to the original pre-edit prompt
  item after a simulated command failure.
- Coalesced lorebook entry edits roll back to the full original collection
  after a simulated command failure.
- The one-entry lorebook edit path keeps its existing lightweight clone budget.
- L25 and L27 are registered as `DONE` in the v3 gate and active-risk table,
  with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/promptTemplateBridge.svelte.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
