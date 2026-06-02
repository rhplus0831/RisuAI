# Lorebooks Collection Path

Status: planned. Tier 4. Depends on the Phase 0 writer kit. Carries a
normalization-drop decision and a Phase 5 resource-split dependency.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 lorebooks row.
- `server/fastify/src/routes/commands.ts` - create (3306), patch (3343), delete
  (3378), reorder (3416), entries (3493).
- `server/fastify/src/routes/projection.ts` - `lorebook` →
  `['characters','modules','loreBook','loreBookPage']` (the broadest; split in
  Phase 5).

## Scope

Edits to the global `loreBook` collection (`lore_books` table) that currently
rewrite all nine collection tables + all characters. Narrow to the `lore_books`
table + settings.

| Route (line) | Desired write |
| --- | --- |
| `POST lorebooks` (3306) | `lore_books` table + settings (`loreBookPage`). |
| `PATCH lorebooks/:id` (3343) | single-row `lore_books` UPDATE, no settings. **The clean one.** |
| `DELETE lorebooks/:id` (3378) | `lore_books` table + settings. |
| `POST lorebooks/reorder` (3416) | `lore_books` table + settings. |
| `PUT lorebooks/:id/entries` (3493) | `lore_books` table + settings. |

`ensureAllChildLorebooks` also repairs `character.globalLore` / `chat.localLore` /
`module.lorebook` in memory; create/reorder/entries currently persist those, so
they are effectively `message-free-downgrade`-only **unless** the slice accepts
dropping child-lorebook normalization (Prerequisite 2 — recorded here). `patch`
(name edit) is the clean single-row case with no settings and no child repair.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, write `lore_books` (single-row
  for patch; full table for create/delete/reorder/entries) + settings
  `loreBookPage` when it changed, inside the revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: child-lorebook repairs across characters/chats/modules
  are dropped to validate-only for create/reorder/entries — recorded here; if a
  reader is found to depend on them, keep those three at the `message-free`
  floor.
- Projection: depends on the Phase 5
  [`lorebook-resource-split.md`](../phase-5-projection-range-narrowing/lorebook-resource-split.md)
  to give global-lorebook events a `['loreBook','loreBookPage']` resource.

## Done When

- `patch` reports `mutationPath: "targeted-collection"` as a single-row write with
  no settings; the other routes write only `lore_books` + settings with the
  child-lorebook normalization recorded as dropped (or stay at the floor with a
  recorded reason).
- Rowid-stability tests prove all characters and the other collection tables are
  untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
