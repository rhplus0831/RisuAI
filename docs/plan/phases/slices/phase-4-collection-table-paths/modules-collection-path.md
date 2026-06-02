# Modules Collection Path

Status: planned. Tier 4. Depends on the Phase 0 writer kit. Carries a Phase 5
projection co-fix and a normalization caveat.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 modules row.
- `server/fastify/src/routes/commands.ts` - patch (3638), reorder (3748),
  :id/lorebooks (4137), :id/scripts (4239), :id/triggers (4273).
- `server/fastify/src/routes/projection.ts` - `module` →
  `['modules','enabledModules','loadouts','characters']` (narrowed in Phase 5).

## Scope

Edits to the `modules` collection that currently rewrite all nine collection
tables + all characters. Narrow to the `modules` table.

| Route (line) | Desired write |
| --- | --- |
| `PATCH modules/:id` (3638) | single-row `modules` (by position). |
| `POST modules/reorder` (3748) | full `modules` table rewrite. |
| `PUT modules/:id/lorebooks` (4137) | single-row `modules` (by position). |
| `PUT modules/:id/scripts` (4239) | full `modules` table rewrite (may touch `characters`). |
| `PUT modules/:id/triggers` (4273) | full `modules` table rewrite (may touch `characters`). |

`:id/scripts` and `:id/triggers` trigger `ensureAllScriptDefinitionCollections`
repairs across all characters + modules, so a faithful narrow write must rewrite
the whole `modules` table (and may touch `characters`) — the verifier downgraded
these from the optimistic single-row claim. `patch`/`:id/lorebooks` are clean
single-row writes; `reorder` is a one-table rewrite.

`DELETE modules/:id` (3673) and `POST modules` (3602) are not here: the delete is
Tier 5 (`removeModuleReferences` spans characters/chats/two collection tables +
settings — Phase 6) and create is Tier 5 `message-free-downgrade` (Phase 6).
modules/enable (3708) is settings-only (Phase 2). The shared `module` projection
is narrowed in Phase 5
([`collection-projection-resources.md`](../phase-5-projection-range-narrowing/collection-projection-resources.md)).

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, write `modules` (single-row for
  patch/:id-lorebooks; full table for reorder/:id-scripts/:id-triggers; the last
  two may also write `characters`), inside the revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: for :id/scripts and :id/triggers the script-definition
  repair is the reason the write spans the whole `modules` table (and possibly
  `characters`); record whether the character-row writes are kept or dropped to
  validate-only.

## Done When

- patch/:id-lorebooks report a single-row `modules` write; reorder/:id-scripts/
  :id-triggers report a full `modules` table rewrite (+ `characters` only where
  the script-definition repair requires it), all `targeted-collection`.
- Rowid-stability tests prove the unrelated collection tables (and all characters
  for patch/reorder/:id-lorebooks) are untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
