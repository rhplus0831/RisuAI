# Personas Collection Path

Status: implemented. Tier 4. Uses the Phase 0 writer kit. Carried the Phase 5
projection-field co-fix.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 personas row and the `persona` projection-field bug.
- `server/fastify/src/routes/commands.ts` - create, patch, delete, select,
  reorder.
- `server/fastify/src/routes/projection.ts` - `persona` →
  `['personas','selectedPersona']` (omits the legacy mirror scalars).

## Scope

Before implementation, edits to the `personas` collection rewrote all nine
collection tables + all characters. The implemented path writes the `personas`
table (+ settings).

| Route | Desired write |
| --- | --- |
| `POST personas` | `personas` table. |
| `PATCH personas/:id` | single-row `personas`. |
| `DELETE personas/:id` | `personas` table + settings (`selectedPersona` + the 4 legacy mirror scalars when `mirrorLegacyProfile`). |
| `POST personas/select` | `personas` table + settings (`selectedPersona` + the 4 legacy mirror scalars `username`/`userIcon`/`personaPrompt`/`userNote` when `mirrorLegacyProfile`). |
| `POST personas/reorder` | `personas` table. |

select/delete also write the legacy mirror scalars (`username`, `userIcon`,
`personaPrompt`, `userNote`) via `mirrorLegacyProfile` — these are not in the
persona projection field set. Projection-field fix: add them to the `persona`
resource (they read straight off the settings row).

Implemented: all five routes moved to `applyTargetedCommandMutation` with
`mutationPath: targeted-collection`. `patch` is a single-row
`writeSingleCollectionRow`; create/delete/reorder rewrite the `personas` table;
`select` rewrites it only when the `saveCurrent` snapshot edits it. Settings are
co-written via `writeSettingsOnly` only when the `selectedPersona` pointer moved
or `mirrorLegacyProfile` rewrote the four legacy scalars — so a no-mirror create
or a pointer-stable patch stays `personas`-only, and a `saveCurrent:false,
mirrorLegacyProfile:false` select narrows to `settings`-only. create reaches a
single-table write (no `message-free-downgrade` floor needed). The `persona`
projection now reships `['personas','selectedPersona','username','userIcon',
'personaPrompt','userNote']`. Proven by `commandCollectionRange.test.ts` (7
personas tests, including the mirror/no-mirror and pointer-only shapes) plus two
`projection.test.ts` assertions.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`,
  `server/fastify/src/routes/projection.ts`.
- Durable path: validate message-free `db.json`, write `personas` (single-row for
  patch; full table for create/delete/select/reorder), settings `selectedPersona`
  + mirror scalars when they changed, inside the revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: global persona repairs are validate-only; confirm the
  create route's reachable target (single-table vs floor).

## Done When

- Each route reports `mutationPath: "targeted-collection"` and writes only
  `personas` (+ settings on select/delete) with `dbJsonWriteMs: 0`, or stays at
  the floor with a recorded reason for create.
- `persona` projection includes the legacy mirror scalars; a projection test
  shows a foreign refresh reflects a `select` that mirrors the profile.
- Rowid-stability tests prove all characters and the other collection tables are
  untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
