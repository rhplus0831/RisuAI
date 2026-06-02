# Personas Collection Path

Status: planned. Tier 4. Depends on the Phase 0 writer kit. Carries a Phase 5
projection-field co-fix.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 personas row and the `persona` projection-field bug.
- `server/fastify/src/routes/commands.ts` - create (1637), patch (1682), delete
  (1732), select (1804), reorder (1850).
- `server/fastify/src/routes/projection.ts` - `persona` →
  `['personas','selectedPersona']` (omits the legacy mirror scalars).

## Scope

Edits to the `personas` collection that currently rewrite all nine collection
tables + all characters. Narrow to the `personas` table (+ settings).

| Route (line) | Desired write |
| --- | --- |
| `POST personas` (1637) | `personas` table. (Appendix lever for 1637 is `message-free-downgrade`; confirm whether create can reach a single-table write or stays at the floor.) |
| `PATCH personas/:id` (1682) | single-row `personas`. |
| `DELETE personas/:id` (1732) | `personas` table + settings (`selectedPersona` + the 4 legacy mirror scalars when `mirrorLegacyProfile`). |
| `POST personas/select` (1804) | `personas` table + settings (`selectedPersona` + the 4 legacy mirror scalars `username`/`userIcon`/`personaPrompt`/`userNote` when `mirrorLegacyProfile`). |
| `POST personas/reorder` (1850) | `personas` table. |

select/delete also write the legacy mirror scalars (`username`, `userIcon`,
`personaPrompt`, `userNote`) via `mirrorLegacyProfile` — these are **not** in the
persona projection field set. **Projection-field fix:** add them to the `persona`
resource (they read straight off the settings row).

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
