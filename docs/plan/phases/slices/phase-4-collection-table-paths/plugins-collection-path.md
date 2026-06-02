# Plugins Collection Path

Status: planned. Tier 4 — do first (projection already narrow, lowest risk).
Depends on the Phase 0 writer kit (`writeSingleCollectionTable` /
`writeSingleCollectionRow`).

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 plugins row.
- `server/fastify/src/routes/commands.ts` - create (3823), patch (3859), delete
  (3894), enable (3931), reorder (3998).
- `server/fastify/src/routes/projection.ts` - `plugins` →
  `['plugins','currentPluginProvider']` (already narrow).

## Scope

Each route edits one element/ordering of the `plugins` collection but rewrites
all nine collection tables + all characters. Narrow to the `plugins` table only.

| Route (line) | Desired write |
| --- | --- |
| `POST plugins` (3823) | `plugins` table rewrite (create shifts positions). |
| `PATCH plugins/:id` (3859) | single-row `UPDATE ... WHERE position=?`. |
| `DELETE plugins/:id` (3894) | `plugins` table rewrite + settings `currentPluginProvider`. |
| `POST plugins/:id/enable` (3931) | single-row `UPDATE ... WHERE position=?`. |
| `POST plugins/reorder` (3998) | `plugins` table rewrite. |

`patch`/`enable` are clean single-row writes; create/delete/reorder are one-table
rewrites. The projection is already narrow, so no Phase 5 co-fix is needed — this
is the lowest-risk Tier-4 family and the audit confirms all routes.

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
