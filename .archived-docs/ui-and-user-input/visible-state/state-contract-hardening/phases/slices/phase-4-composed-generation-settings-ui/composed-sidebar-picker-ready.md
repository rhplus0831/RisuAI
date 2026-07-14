# Slice: Composed Sidebar Picker Ready Path

Phase: [4](../../phase-4-composed-generation-settings-ui.md). Test change.

Status: complete. Depended on Phase 2
[`generation-settings-selectors.md`](../phase-2-selector-hardening/generation-settings-selectors.md).

## Scope

Add a composed DOM test for the real active-chat generation-settings path:
`Toggles` plus `CustomSidebar` opens preset/persona pickers, selects rows, saves
chat-owned settings, and returns to a visible ready state.

This slice does not change server validation or generation-settings state
models.

## Visible Contract

A user can configure a chat-scoped preset/persona through the visible sidebar
and pickers without mutating global preset/persona selection.

## Anchors

- `src/lib/SideBars/Toggles.svelte`
- `src/lib/SideBars/CustomSidebar.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/ts/stores.svelte.ts`
- `src/ts/activeChatGenerationSettings.ts`
- `src/ts/chatGenerationSettings.ts`

## Target Shape

- Mount a small host that renders `Toggles` and app-level
  `Botpreset`/`ListedPersona` modals based on modal stores.
- Click sidebar preset and persona controls through stable selectors.
- Select picker rows through stable row selectors.
- Assert active chat `generationSettings` changes.
- Assert global `botPresetsId` and `selectedPersona` do not change.
- Assert readiness/labels visibly reflect the selected rows.

## Invariants

- Keep this test contract-oriented and small.
- Do not duplicate server command validation already covered by Fastify tests.
- Do not use broad snapshot-style text assertions.

## Done Criteria

- At least one composed sidebar-to-picker-to-ready DOM test exists.
- The test proves global state is not retargeted.

## Validation

```bash
pnpm exec vitest run \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts
```
