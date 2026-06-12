# Slice: ModuleSettings Derived Search

Phase: [5](../../phase-5-client-render-and-ui.md). Finding: L43. Runtime
change.

Status: complete; proof refreshed in
[`phase-5-verification-refresh.md`](phase-5-verification-refresh.md).

## Scope

Move module filtering/sorting out of the `ModuleSettings` template into
Svelte-derived state and key module rows by id.

This slice does not change module import/export, enable/disable commands,
editing, MCP modules, or module persistence.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L43.
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte`: `sortModules`,
  `moduleSearch`, `DBState.db.modules`, `enabledModules`, module integration
  class logic, and the unkeyed `{#each}`.
- New focused test home:
  `src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts`.

## Target Shape

- Normalize `moduleSearch` once in `$derived` state.
- Replace `sortModules(DBState.db.modules, moduleSearch)` in the template with
  a derived sorted list that recomputes only when modules or search text
  change.
- Preserve the current sort order: name ascending by lowercase
  `localeCompare`.
- Key the `{#each}` by `rmodule.id`.
- If useful, derive `moduleIntergration` namespaces into a `Set` once instead
  of splitting and trimming inside every row render.
- Avoid per-row `findIndex` work on edit by carrying original module index in
  the derived row, or keep the lookup only if tests prove the template no
  longer repeats full filtering/sorting work.
- Register L43 as `DONE` in the v2 gate with focused module-list tests, and
  flip the L43 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Empty search still shows all modules in the same order.
- Search matching remains case-insensitive against module names.
- Enable, export, edit, delete, import, and MCP indicators must still target
  the same module ids.
- `refreshModules()` on destroy remains unchanged.

## Done Criteria

- Module search/filter/sort work is performed by `$derived`, not by a template
  function call.
- Module rows are keyed by stable id.
- Focused tests cover empty search, filtered search, sorted order, and edit
  targeting after filtering.
- L43 is registered as `DONE` with real tests in the v2 gate and risk map.

## Validation

```bash
pnpm exec vitest run src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm check
pnpm exec tsc -p tsconfig.client-lib.json
```
