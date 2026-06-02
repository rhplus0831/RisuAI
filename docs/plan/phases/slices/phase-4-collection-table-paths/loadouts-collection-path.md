# Loadouts Collection Path

Status: planned. Tier 4. Depends on the Phase 0 writer kit. Carries a Phase 5
projection-field co-fix.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 loadouts row and the `loadout` projection-field bug.
- `server/fastify/src/routes/commands.ts` - create (2085), patch (2121), delete
  (2163), favorite (2197), touch (2232).
- `server/fastify/src/routes/projection.ts` - `loadout` → `['loadouts']` (omits
  `lastLoadedLoadoutName`).

## Scope

Edits to the `loadouts` collection that currently rewrite all nine collection
tables + all characters. Narrow to the `loadouts` table + settings.

| Route (line) | Desired write |
| --- | --- |
| `POST loadouts` (2085) | `loadouts` table + settings (`lastLoadedLoadoutName` defaulted by `ensureLoadoutCollection`). |
| `PATCH loadouts/:id` (2121) | `loadouts` table + settings. |
| `DELETE loadouts/:id` (2163) | `loadouts` table + settings. |
| `POST loadouts/:id/favorite` (2197) | `loadouts` table (pure field edit, but the repair pass rewrites the whole array → full one-table rewrite). |
| `POST loadouts/:id/touch` (2232) | `loadouts` table + settings (`lastLoadedLoadoutName` written explicitly). |

`favorite`/`touch` are pure field edits but `ensureLoadoutCollection` rewrites the
whole array on every call, so they are full one-table rewrites, not single-row.
**Projection-field fix:** `loadout` omits `lastLoadedLoadoutName`, which
`touch`/`delete` write — add it (see
[`../phase-5-projection-range-narrowing/projection-field-bug-fixes.md`](../phase-5-projection-range-narrowing/projection-field-bug-fixes.md)).

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`,
  `server/fastify/src/routes/projection.ts`.
- Durable path: validate message-free `db.json`, full `loadouts` table rewrite +
  settings `lastLoadedLoadoutName` when it changed, inside the revision/event
  transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: `ensureLoadoutCollection`'s whole-array reassignment is
  by design; cross-family de-dup stays validate-only.

## Done When

- Each route reports `mutationPath: "targeted-collection"` and writes only
  `loadouts` + settings, with `dbJsonWriteMs: 0`.
- `loadout` projection includes `lastLoadedLoadoutName`; a projection test shows a
  foreign refresh reflects a `touch`.
- Rowid-stability tests prove all characters and the other collection tables are
  untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
