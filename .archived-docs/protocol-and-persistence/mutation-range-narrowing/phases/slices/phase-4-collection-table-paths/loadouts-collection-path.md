# Loadouts Collection Path

Status: implemented. Tier 4. Uses the Phase 0 writer kit. Carried the Phase 5
projection-field co-fix.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 loadouts row and the `loadout` projection-field bug.
- `server/fastify/src/routes/commands.ts` - create, patch, delete, favorite,
  touch.
- `server/fastify/src/routes/projection.ts` - `loadout` → `['loadouts']` (omits
  `lastLoadedLoadoutName`).

## Scope

Before implementation, edits to the `loadouts` collection rewrote all nine
collection tables + all characters. The implemented path writes the `loadouts`
table + settings.

| Route | Desired write |
| --- | --- |
| `POST loadouts` | `loadouts` table + settings (`lastLoadedLoadoutName` defaulted by `ensureLoadoutCollection`). |
| `PATCH loadouts/:id` | `loadouts` table + settings. |
| `DELETE loadouts/:id` | `loadouts` table + settings. |
| `POST loadouts/:id/favorite` | `loadouts` table (pure field edit, but the repair pass rewrites the whole array → full one-table rewrite). |
| `POST loadouts/:id/touch` | `loadouts` table + settings (`lastLoadedLoadoutName` written explicitly). |

`favorite`/`touch` are pure field edits but `ensureLoadoutCollection` rewrites the
whole array on every call, so they are full one-table rewrites, not single-row.
Projection-field fix: `loadout` omits `lastLoadedLoadoutName`, which
`touch`/`delete` write — add it (see
[`../phase-5-projection-range-narrowing/projection-field-bug-fixes.md`](../phase-5-projection-range-narrowing/projection-field-bug-fixes.md)).

Implemented: all five routes moved to `applyTargetedCommandMutation` with
`mutationPath: targeted-collection`, each ending in the shared
`writeLoadoutMutation` helper — a full `writeSingleCollectionTable(db,
'loadouts', …)` rewrite (faithful, since `ensureLoadoutCollection` reassigns the
whole array by design) plus a `writeSettingsOnly` only when
`lastLoadedLoadoutName` actually moved (captured after the ensure-normalize). In
practice only `touch` moves it, so create/patch/delete/favorite report
`writtenTables: ['loadouts']` and touch reports `['loadouts','settings']` — the
slice's "+settings" upper bound narrowed to the precise pointer-changed case. The
`loadout` projection now reships `['loadouts','lastLoadedLoadoutName']`. Proven by
`commandCollectionRange.test.ts` (5 loadouts tests) plus two `projection.test.ts`
assertions.

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
