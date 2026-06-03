# Plugins Collection Path

Status: implemented. Tier 4 — done first (projection already narrow, lowest
risk). Uses the Phase 0 writer kit (`writeSingleCollectionTable` /
`writeSingleCollectionRow`).

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 plugins row.
- `server/fastify/src/routes/commands.ts` - create, patch, delete, enable,
  reorder.
- `server/fastify/src/routes/projection.ts` - `plugins` →
  `['plugins','currentPluginProvider']` (already narrow).

## Scope

Each route edits one element/ordering of the `plugins` collection but rewrites
all nine collection tables + all characters. Narrow to the `plugins` table only.

| Route | Desired write |
| --- | --- |
| `POST plugins` | `plugins` table rewrite (create shifts positions). |
| `PATCH plugins/:id` | single-row `UPDATE ... WHERE position=?`. |
| `DELETE plugins/:id` | `plugins` table rewrite + settings `currentPluginProvider`. |
| `POST plugins/:id/enable` | single-row `UPDATE ... WHERE position=?`. |
| `POST plugins/reorder` | `plugins` table rewrite. |

`patch`/`enable` are clean single-row writes; create/delete/reorder are one-table
rewrites. The projection was already narrow, so this was the lowest-risk Tier-4
family and the audit confirms all routes.

Implemented: all five routes moved from `applyMessageFreeJsonCommandMutation` to
`applyTargetedCommandMutation` with `mutationPath: targeted-collection`. `patch`
and `enable` call `writeSingleCollectionRow(db, 'plugins', index, plugins[index])`
(index == position because `loadCollectionsFromSqlite` orders by position);
`create`/`delete`/`reorder` call `writeSingleCollectionTable(db, 'plugins', …)`.
`delete` co-writes settings via `writeSettingsOnly` only when the deleted plugin
was the active `currentPluginProvider` (the pointer clears). Proven by
`commandCollectionRange.test.ts` (6 plugins tests: targeted path + exact `writtenTables`
+ character/chat rowid stability + plugins-table rowid stability for the
single-row edits + the conditional settings co-write).

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, write the `plugins` table (or a
  single position row) + settings `currentPluginProvider` on delete, inside the
  revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: global plugin repairs are validate-only.

## Done When

- Each route reports `mutationPath: "targeted-collection"` and writes only the
  `plugins` table (+ settings on delete) with `dbJsonWriteMs: 0`.
- Rowid-stability tests prove the other eight collection tables and all
  characters are untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
