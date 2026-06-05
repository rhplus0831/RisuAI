# Slice: Prompt Template Tokenize Debounce

Phase: [5](../../phase-5-client-render-and-ui.md). Finding: M13. Runtime
change.

## Scope

Debounce prompt-template token-count recomputation and memoize token counts per
prompt item so typing in one item no longer re-tokenizes the whole template
twice per keystroke.

This slice does not change prompt-template persistence, projection writes,
server-command debounce, drag/reorder behavior, or `templateCheck` warnings.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M13.
- `src/lib/Setting/Pages/PromptSettings.svelte`: `executeTokenize`,
  `promptTemplateDraft`, token count state, and the `$effect.pre` that calls
  `executeTokenize(promptTemplateDraft.value)`.
- `src/ts/process/prompt.ts`: `tokenizePreset`, `PromptItem`, and the item
  types that contribute tokenized text.
- `src/ts/tokenizer.ts`: `tokenizeAccurate`.
- Precedent: `src/lib/SideBars/CharConfig.svelte` `scheduleTokenize` and
  `tokenizeRun`.
- New focused test home: `src/ts/process/promptTokenizeMemo.test.ts` and, if
  component behavior needs proof, `src/lib/Setting/Pages/PromptSettings.svelte.test.ts`.

## Target Shape

- Replace the immediate per-change `executeTokenize()` effect with a trailing
  250-400 ms debounce and a run counter that discards stale async tokenization
  results.
- Keep the initial mount count behavior: counts may settle asynchronously, but
  the displayed `tokens` and `extokens` must end up identical to the old
  `tokenizePreset(..., true/false)` totals.
- Add a per-item memo keyed by stable item identity plus tokenized content:
  `(id, type, text, innerFormat)` or an equivalent signature. Avoid mutating
  the template just to create a cache key; if an item has no id, use a
  positional or content fallback until the existing normalization path assigns
  one.
- Compute both `consti` variants for a changed item once, then sum cached item
  totals for the current template order.
- Prune or naturally ignore memo entries for deleted items; reorder should
  reuse item totals and only change the summation order.
- Keep server write debounce in `queuePromptItemUpdate` unchanged.
- Register M13 as `DONE` in the v2 gate with focused tokenization cost and
  behavior tests, and flip the M13 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Token totals after debounce settle must match the old full-template
  `tokenizePreset` totals for every supported prompt item type.
- Rapid typing must not let an older async tokenization result overwrite a
  newer edit.
- The token-count path must not dispatch server commands or broaden projection
  writes.
- `templateCheck(DBState.db)` timing and warning output are not part of this
  optimization and should remain behavior-identical.

## Done Criteria

- Typing several characters into one prompt item triggers at most one
  debounced recompute after the final keystroke.
- Unchanged prompt items hit the per-item memo for both `consti` variants.
- Reordering, deleting, and adding prompt items produce the same displayed
  totals after settle.
- The M13 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/promptTokenizeMemo.test.ts src/lib/Setting/Pages/PromptSettings.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm check
pnpm exec tsc -p tsconfig.client-lib.json
```
