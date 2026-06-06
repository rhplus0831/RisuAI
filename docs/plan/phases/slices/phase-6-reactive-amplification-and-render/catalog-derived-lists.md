# Slice: Catalog Derived Lists

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Finding: M6.
Riding informational item: I12, if it lands in the same edit. Client render
memoization.

## Scope

Move collection-sized character and module list formatting out of inline
template calls and into `$derived` values backed by pure helper functions.

This slice owns the default character catalog path through
`MobileCharacters.svelte`, including the mobile home list and the
`GridCatalog.svelte` default tab delegation. It may also fix the
`ModuleChatMenu.svelte` sibling sort if that is still a small same-pattern
edit. It does not change character ordering semantics, search behavior,
trash filtering, module enablement behavior, or the projection guard.

If I18 is picked up opportunistically, keep it to dependency narrowing for
`templateCheck(DBState.db)` in Prompt Settings. Do not expand this slice into
prompt-template command behavior.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  M6, I12, I18, and I19 context.
- `src/lib/Mobile/MobileCharacters.svelte`: `sortChar`, `makeAgoText`, and
  the inline `{#each sortChar(DBState.db.characters) ...}` call.
- `src/lib/Mobile/MobileBody.svelte`: mobile home list call site.
- `src/lib/Others/GridCatalog.svelte`: `formatGridCatalogCharacterLists`,
  `normalizeGridCatalogSearch`, default `selected === 3` tab, and keyed-list
  precedent.
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte`:
  `sortModuleSettingsRows` and keyed each precedent.
- `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte`: optional I12 inline
  `sortModules(DBState.db.modules, moduleSearch)` call.
- `src/lib/Setting/Pages/PromptSettings.svelte` and
  `src/ts/process/templates/templateCheck.ts`: optional I18
  dependency-narrowing rider.
- Focused tests:
  `src/lib/Others/GridCatalog.svelte.test.ts` and
  `src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts`.

## Target Shape

- Extract MobileCharacters row formatting into a module-script helper that is
  pure and unit-testable. Include the existing inputs explicitly:
  characters, `hideTrash`, the relative-time formatter, and the current time
  source if tests need deterministic ago text.
- Build the expensive formatted+sorted character list with `$derived`, keyed
  only by corpus/order/filter invalidators. Keep search filtering cheap and
  separate so typing in the search box does not re-run `map -> format -> sort`
  unless the chosen helper intentionally combines search and proves equivalent
  cost.
- Replace the MobileCharacters `{#each}` with a keyed each using a stable key
  such as `chaId || legacy-index`.
- Preserve the exact ordering:
  newest `lastInteraction` first, name locale compare as the tie-breaker, and
  existing `hideTrash` behavior.
- If I12 rides, mirror the ModuleSettings pattern:
  normalize search once, compute sorted module rows with `$derived`, and key
  rows by module id. Keep enabled/global/chat-specific module styling and
  toggles unchanged.
- If I18 rides, narrow the Prompt Settings `templateCheck` dependency to a
  cheap signature or derived value that changes only when the prompt-template
  fields it actually reads change.
- Register M6 as `DONE` in the v3 gate and flip only the M6 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
  Mention I12/I18 in proof text only when they actually landed.

## Invariants

- The projection proxy re-mint from I19 stays unchanged.
- Character names, images, chat counts, ago text, click targets, and trash
  inclusion are output-identical for the same input and time source.
- Search still ignores spaces and case in the same places it does now.
- Keyed each keys must be stable for persisted ids and safe for legacy rows
  without ids.
- Optional riders must stay output-identical and must not change command or
  persistence semantics.

## Done Criteria

- MobileCharacters no longer calls `sortChar(DBState.db.characters)` directly
  from the template.
- A focused regression proves the formatted+sorted character list recomputes
  on corpus/filter changes, not on unrelated renders.
- The MobileCharacters each block is keyed.
- The pure helper has deterministic unit coverage for ordering, trash
  filtering, legacy ids, and ago text.
- If I12 rides, ModuleChatMenu uses the derived/keyed row shape and keeps
  module toggling behavior intact.
- M6 is registered as `DONE` in the v3 gate and active-risk table, with
  riding item coverage noted only if present.

## Validation

```bash
pnpm exec vitest run \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
