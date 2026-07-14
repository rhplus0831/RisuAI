# Slice: Delete Invalidation Readiness

Phase: [4](../../phase-4-composed-generation-settings-ui.md). Test change.

Status: complete. Depended on Phase 2
[`generation-settings-selectors.md`](../phase-2-selector-hardening/generation-settings-selectors.md).

## Scope

Pin the visible behavior when a referenced preset or persona is missing or
deleted.

This slice should prefer helper plus visible DOM proof over new server behavior.

## Visible Contract

Deleting or removing a referenced preset/persona must leave the chat-owned id
intact, report readiness as missing, and avoid silently retargeting to a
global/default row.

## Anchors

- `src/ts/chatGenerationSettings.ts`
- `src/ts/activeChatGenerationSettings.ts`
- `src/lib/SideBars/Toggles.svelte`
- `src/lib/SideBars/chatGenerationSettingsControls.test.ts`
- `src/lib/Setting/pickerGenerationSettings.test.ts`

## Target Shape

- Seed a chat whose `generationSettings` references an id not present in
  `DBState.db.botPresets` or `DBState.db.personas`.
- Assert helper readiness returns missing preset/persona state.
- Mount visible controls and assert missing/unconfigured labels.
- Assert the chat-owned id remains unchanged after visible rendering.
- Assert send readiness blocks through existing guard helpers or a small visible
  send assertion.

## Invariants

- Do not retarget missing ids to global selected rows.
- Do not mutate global preset/persona selection.

## Done Criteria

- Missing referenced ids are pinned in helper/state coverage and visible DOM.
- The test proves no implicit retarget occurs.

## Validation

```bash
pnpm exec vitest run \
  src/ts/chatGenerationSettings.test.ts \
  src/ts/activeChatGenerationSettings.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts
```
