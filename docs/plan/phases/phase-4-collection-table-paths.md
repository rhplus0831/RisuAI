# Phase 4: Collection-Table Paths

Status: planned. Depends on the Phase 0 writer kit
(`writeSingleCollectionTable` / `writeSingleCollectionRow`, `writeSettingsOnly`)
and review gates.

Goal: narrow Tier-4 edits to the one collection table that changed. Pure field
edits use one-row `UPDATE ... WHERE position=?`; create/delete/reorder rewrite
that one table. Settings pointer scalars ride along only when they changed. Each
slice owns one collection family and its projection-field co-fix.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) - the
  Tier-4 family table.
- `server/fastify/src/routes/commands.ts` - the family routes.
- `server/fastify/src/repository.ts` - the nine collection tables and the
  collection writers.
- `server/fastify/src/routes/projection.ts` - `prompt`/`promptItem`/`persona`/
  `loadout`/`plugins` resources.
- [`slices/phase-0-baseline-foundations/normalization-scope-policy.md`](slices/phase-0-baseline-foundations/normalization-scope-policy.md) -
  the validate-only / settings co-write contract (Prerequisites 2-3) and the
  shared `assertOnlyRowsWritten` rowid-stability helper this phase's slices use.

## Slices

Ordered easiest/lowest-risk first.

- [`plugins-collection-path.md`](slices/phase-4-collection-table-paths/plugins-collection-path.md) -
  `plugins` (create 3823, patch 3859, delete 3894, enable 3931, reorder 3998).
  Projection already narrow → lowest risk; do first.
- [`presets-collection-path.md`](slices/phase-4-collection-table-paths/presets-collection-path.md) -
  `bot_presets` (create 1105, patch 1143, delete 1185, copy 1251, select 1299,
  import 1341, reorder 1379). select/delete with `apply=true` also write
  `prompt_templates` + ~73 settings scalars.
- [`prompt-items-collection-path.md`](slices/phase-4-collection-table-paths/prompt-items-collection-path.md) -
  `prompt_templates` (create 1453, patch 1489, delete 1528, enable 1562, reorder
  1601) + the `promptItem` projection-field fix.
- [`personas-collection-path.md`](slices/phase-4-collection-table-paths/personas-collection-path.md) -
  `personas` (create 1637, patch 1682, delete 1732, select 1804, reorder 1850) +
  `selectedPersona` + the legacy mirror scalars.
- [`translator-presets-collection-path.md`](slices/phase-4-collection-table-paths/translator-presets-collection-path.md) -
  `translator_presets` (create 1895, patch 1936, delete 1984) and select (2050,
  reclassified here from Tier 1) + unconditional settings write.
- [`loadouts-collection-path.md`](slices/phase-4-collection-table-paths/loadouts-collection-path.md) -
  `loadouts` (create 2085, patch 2121, delete 2163, favorite 2197, touch 2232) +
  `lastLoadedLoadoutName`.
- [`lorebooks-collection-path.md`](slices/phase-4-collection-table-paths/lorebooks-collection-path.md) -
  `lore_books` (create 3306, patch 3343, delete 3378, reorder 3416, entries 3493)
  + `loreBookPage` + the child-lorebook normalization-drop decision.
- [`modules-collection-path.md`](slices/phase-4-collection-table-paths/modules-collection-path.md) -
  `modules` (patch 3638, reorder 3748, :id/lorebooks 4137, :id/scripts 4239,
  :id/triggers 4273) + the scripts/triggers normalization caveat.

## Exit Criteria

- Each family route writes only its own collection table (single-row for pure
  field edits; one-table rewrite for create/delete/reorder) plus its pointer
  scalar in settings only when it changed.
- The two-table cases are explicit: presets select/delete with `apply=true`
  (+`prompt_templates` + settings), modules :id/scripts and :id/triggers (whole
  `modules` table, may touch `characters`).
- Rowid-stability tests prove the other eight collection tables and all
  characters are untouched.
- The `promptItem` (→`promptTemplate`), `persona` (+mirror scalars), and
  `loadout` (+`lastLoadedLoadoutName`) projection-field bugs are fixed in their
  family slices.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
