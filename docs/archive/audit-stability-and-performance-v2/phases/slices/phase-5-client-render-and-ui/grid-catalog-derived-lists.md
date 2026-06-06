# Slice: GridCatalog Derived Lists

Phase: [5](../../phase-5-client-render-and-ui.md). Finding: L42. Runtime
change.

Status: complete; proof refreshed in
[`phase-5-verification-refresh.md`](phase-5-verification-refresh.md).

## Scope

Memoize `GridCatalog` character filtering with Svelte `$derived` state and key
the repeated rows/icons so search typing and tab renders do not rescan the
character corpus multiple times.

This slice does not change character order, trash semantics, mobile character
rendering, or character selection/removal commands.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L42.
- `src/lib/Others/GridCatalog.svelte`: `formatChars`, `search`, `selected`,
  the count display, and the grid/list/trash `{#each}` blocks.
- `src/lib/Mobile/MobileCharacters.svelte`: selected simple-mode consumer of
  the same search string.
- New focused test home: `src/lib/Others/GridCatalog.svelte.test.ts`.

## Target Shape

- Normalize the search string once in `$derived` state.
- Replace template calls to `formatChars(search, DBState.db, ...)` with derived
  active and trash character lists, or a single derived object containing both
  lists and the count.
- Ensure the count display reads the same derived non-trash list used by the
  active tabs.
- Key grid/list/trash `{#each}` blocks by stable character id when available
  (`chaId`), with an index fallback for legacy rows.
- Keep the existing filtering behavior: ignore spaces, lowercase by locale,
  include active rows only outside trash, include trash rows only in trash.
- Add a focused test or helper test proving search changes recompute the
  formatted list once per change and that tab switches reuse the relevant
  derived list.
- Register L42 as `DONE` in the v2 gate with focused list behavior/cost tests,
  and flip the L42 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Character order, displayed names/descriptions, and image fallback behavior
  must remain unchanged.
- Trash restore/permanent-delete buttons must still target the same character
  row as before filtering.
- Simple/mobile mode must continue receiving the live search text.
- Derived state must update when character names, images, trash state, or
  order change.

## Done Criteria

- Grid, list, and trash modes no longer call a filtering function from the
  template on every render.
- The repeated character rows/icons are keyed.
- Search, tab switch, select, trash, restore, and count behavior remain
  identical in focused tests.
- L42 is registered as `DONE` with real tests in the v2 gate and risk map.

## Validation

```bash
pnpm exec vitest run src/lib/Others/GridCatalog.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm check
pnpm exec tsc -p tsconfig.client-lib.json
```
