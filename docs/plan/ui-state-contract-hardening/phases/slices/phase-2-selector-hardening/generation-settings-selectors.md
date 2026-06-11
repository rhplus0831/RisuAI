# Slice: Generation Settings Selectors

Phase: [2](../../phase-2-selector-hardening.md). Runtime selector and test
change.

Status: planned.

## Scope

Add stable selectors for active-chat generation-settings controls and
preset/persona pickers.

This slice does not add new composed workflow tests; Phase 4 owns those.

## Visible Contract

Generation settings controls, picker mode, picker rows, and selected state must
be assertable by domain intent rather than broad button text, `alt` attributes,
generic `select`/input lookup, or `bg-selected`.

## Anchors

- `src/lib/SideBars/Toggles.svelte`
- `src/lib/SideBars/CustomSidebar.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/lib/SideBars/chatGenerationSettingsControls.test.ts`
- `src/lib/Setting/pickerGenerationSettings.test.ts`

## Target Shape

- Controls expose toggle key/kind, input kind, jailbreak control, picker kind,
  active picker mode, and selected state.
- Preset/persona rows expose row id/index and `aria-selected` or `aria-current`.
- Tests click and assert via those selectors.

## Invariants

- Prefer wrapper attributes because shared GUI primitives do not broadly forward
  arbitrary `data-*` and ARIA props.
- Do not mutate global preset/persona behavior.
- Do not duplicate Phase 4 workflow coverage.

## Done Criteria

- Control and picker tests no longer rely on `bg-selected`, generic first input,
  or button text for core state assertions.
- Phase 4 can reuse the selectors.

## Validation

```bash
pnpm exec vitest run \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts
```
