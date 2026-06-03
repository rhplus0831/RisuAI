# Modules Collection Path

Status: implemented (write-narrowing). Tier 4. Uses the Phase 0 writer kit. The
shared `module` projection narrowing landed in Phase 5.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 modules row.
- `server/fastify/src/routes/commands.ts` - patch, reorder,
  :id/lorebooks, :id/scripts, :id/triggers.
- `server/fastify/src/routes/projection.ts` - `moduleUpdated`,
  `moduleReordered`, `moduleEnabled`, `moduleScriptDefinition`, and
  `moduleTriggerDefinition` are the Phase 5 narrow module resources.

## Scope

Before implementation, edits to the `modules` collection rewrote all nine
collection tables + all characters. The implemented path writes the `modules`
table.

| Route | Desired write |
| --- | --- |
| `PATCH modules/:id` | single-row `modules` (by position). |
| `POST modules/reorder` | full `modules` table rewrite. |
| `PUT modules/:id/lorebooks` | single-row `modules` (by position). |
| `PUT modules/:id/scripts` | full `modules` table rewrite; character repairs are validate-only. |
| `PUT modules/:id/triggers` | full `modules` table rewrite; character repairs are validate-only. |

`:id/scripts` and `:id/triggers` trigger `ensureAllScriptDefinitionCollections`.
The implemented decision drops the parallel character repairs to validate-only
and rewrites the whole `modules` table. `patch`/`:id/lorebooks` are clean
single-row writes; `reorder` is a one-table rewrite.

Implemented: all five in-scope routes moved to `applyTargetedCommandMutation`
with `mutationPath: targeted-collection`. `patch` and `:id/lorebooks` are
single-row `writeSingleCollectionRow(db, 'modules', index, …)` writes (the latter
also drops the in-memory child-lorebook repairs across characters/chats to
validate-only); `reorder`, `:id/scripts`, and `:id/triggers` are full
`writeSingleCollectionTable(db, 'modules', …)` rewrites. Normalization decision
recorded: for `:id/scripts` / `:id/triggers` the parallel character
`customscript`/`triggerscript` repairs are **dropped to validate-only**
(Prerequisite 2) — the narrow write touches only `modules`, never `characters`,
which both keeps the writes within the `targeted-collection` gate (it forbids
characters/chats) and is what `writtenTables: ['modules']` proves. Every route
reports `['modules']`. Proven by `commandCollectionRange.test.ts` (5 modules
tests, incl. modules rowid stability for the single-row edits and the
characters-untouched assertion for scripts/triggers). The shared broad `module`
projection resource was split in the Phase 5 collection-projection slice.

`DELETE modules/:id` and `POST modules` are not here: the delete is
Tier 5 (`removeModuleReferences` spans characters/chats/two collection tables +
settings — Phase 6) and create is Tier 5 `message-free-downgrade` (Phase 6).
modules/enable is settings-only (Phase 2). The shared `module` projection
was narrowed in Phase 5
([`collection-projection-resources.md`](../phase-5-projection-range-narrowing/collection-projection-resources.md)).

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, write `modules` (single-row for
  patch/:id-lorebooks; full table for reorder/:id-scripts/:id-triggers), inside
  the revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: for :id/scripts and :id/triggers the
  script-definition repair is the reason the write spans the whole `modules`
  table; character-row repairs are dropped to validate-only.

## Done When

- patch/:id-lorebooks report a single-row `modules` write; reorder/:id-scripts/
  :id-triggers report a full `modules` table rewrite, all
  `targeted-collection`.
- Rowid-stability tests prove the unrelated collection tables (and all characters
  for patch/reorder/:id-lorebooks) are untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
