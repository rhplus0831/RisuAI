# Slice: Module And Grid Selectors

Phase: [2](../../phase-2-selector-hardening.md). Runtime selector and test
change.

Status: planned.

## Scope

Add stable row, state, and action selectors to module settings and grid catalog
surfaces, then migrate nearby tests away from structural CSS selectors and
button-order destructuring.

## Visible Contract

Module and character rows must expose the row id/index, state, and action kind
the user is acting on.

## Anchors

- `src/lib/Setting/Pages/Module/ModuleSettings.svelte`
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts`
- `src/lib/Others/GridCatalog.svelte`
- `src/lib/Others/GridCatalog.svelte.test.ts`
- `src/lib/Mobile/MobileCharacters.svelte`

## Target Shape

- Module rows expose module id, enabled state, integration state, and action
  kind selectors.
- Grid list/trash rows expose character id/index, list kind, selected state
  where applicable, and action kind selectors.
- Tests stop destructuring `querySelectorAll('button')` by order for core
  actions.

## Invariants

- Do not change list sorting/filtering behavior.
- Keep current `GridCatalog` simple-mode delegation to `MobileCharacters`
  unless a selector needs a minimal passthrough.

## Done Criteria

- Module and grid tests click actions by semantic action selectors.
- Existing derived-list behavior tests still pass.

## Validation

```bash
pnpm exec vitest run \
  src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts \
  src/lib/Others/GridCatalog.svelte.test.ts
```
