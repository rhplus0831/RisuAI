# Slice: Sidebar Tab Selectors

Phase: [2](../../phase-2-selector-hardening.md). Runtime selector and test
change.

Status: planned.

## Scope

Add stable selectors to `Sidebar.svelte` tabs and panels so Phase 3 can click
and assert the Chat/Character tab state without localized text or class
coupling.

This slice is a prerequisite for Phase 3.

## Visible Contract

The sidebar must expose which tab is active and which panel is visible through
stable DOM attributes.

## Anchors

- `src/lib/SideBars/Sidebar.svelte`
- `src/lib/SideBars/CharConfig.svelte`
- `src/lib/SideBars/SideChatList.svelte`
- `src/App.routeEffect.dom.test.ts` after Phase 3 creates it

## Target Shape

- Chat and Character tab buttons expose `data-risu-sidebar-tab="chat"` and
  `data-risu-sidebar-tab="character"`.
- Tab selected state is exposed with `aria-selected`, `aria-current`, or a
  domain `data-risu-sidebar-tab-active` attribute.
- Visible panel wrappers expose stable panel markers such as
  `data-risu-sidebar-panel="chat"` and `data-risu-sidebar-panel="character"`.

## Invariants

- Do not change `botMakerMode` semantics.
- Keep dev-tool and quick-settings rendering behavior unchanged.
- Avoid text-based selectors in Phase 3 once this slice lands.

## Done Criteria

- Sidebar tab and panel state can be asserted without reading Tailwind classes.
- Phase 3 has stable selectors available.

## Validation

```bash
pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts
pnpm check
```
