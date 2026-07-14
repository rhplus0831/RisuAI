# Slice: Sidebar Character List Signature

Phase: [5](../../phase-5-client-render-and-ui.md). Finding: L44. Runtime
change.

Status: complete; proof refreshed in
[`phase-5-verification-refresh.md`](phase-5-verification-refresh.md).

## Scope

Replace the sidebar character-list rebuild plus lodash deep compare with a
cheap signature or derived memo that updates only when list-affecting character
or folder fields change.

This slice does not change drag/reorder semantics, folder behavior, character
selection, or sidebar layout.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L44.
- `src/lib/SideBars/Sidebar.svelte`: `charImages`, `IconRounded`, the
  `$effect` that rebuilds `newCharImages`, lodash `isEqual`, and drag/drop
  consumers.
- `src/ts/util.ts`: `getCharacterIndexObject`.
- `src/ts/storage/database.svelte.ts`: `characterOrder` and character metadata
  shapes.
- New focused test home: `src/lib/SideBars/Sidebar.charList.test.ts` or a
  helper-level test if the signature builder is extracted.

## Target Shape

- Extract sidebar list construction into a small helper or `$derived.by` block
  that is easy to test.
- Compute a cheap signature from only the fields that affect the rendered
  sidebar list: `characterOrder` ids/folders, folder name/color/image/data, and
  each referenced character's id/name/image/index.
- Update `charImages` only when that signature changes, or replace mutable
  `charImages` assignment with a derived list consumed directly by the
  template.
- Remove the lodash `isEqual` import if no longer used.
- Keep `IconRounded` as a direct cheap assignment or derived value; do not
  rebuild the character list solely because `roundIcons` changes.
- Add tests proving unrelated character metadata changes do not rebuild the
  list, while name/image/order/folder changes do.
- Register L44 as `DONE` in the v2 gate with focused signature/list tests, and
  flip the L44 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Folder and character ordering must remain identical to
  `DBState.db.characterOrder`.
- Drag/drop must still use the same indices and folder ids.
- Name/image updates must show up promptly.
- Unrelated metadata changes, chat changes, and character row fields not used
  by the sidebar list should not trigger a full list rebuild.

## Done Criteria

- Sidebar list updates are guarded by a cheap signature or derived dependencies,
  not a full deep comparison of rebuilt arrays.
- The lodash `isEqual` dependency is removed from `Sidebar.svelte` if unused.
- Focused tests prove both ignored and list-affecting updates.
- L44 is registered as `DONE` with real tests in the v2 gate and risk map.

## Validation

```bash
pnpm exec vitest run src/lib/SideBars/Sidebar.charList.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm check
pnpm exec tsc -p tsconfig.client-lib.json
```
