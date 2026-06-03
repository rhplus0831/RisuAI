# Prompt Items Collection Path

Status: implemented. Tier 4. Uses the Phase 0 writer kit. Carried the Phase 5
projection-field co-fix.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 prompt-items row and the `promptItem` projection-field bug.
- `server/fastify/src/routes/commands.ts` - create, patch, delete, enable,
  reorder.
- `server/fastify/src/routes/projection.ts` - `promptItem` now ships
  `['promptTemplate']`; before this slice it incorrectly shipped
  `['botPresets']`.

## Scope

Before implementation, edits to the `promptTemplate` collection
(`prompt_templates` table) rewrote all nine collection tables + all characters.
The implemented path writes the `prompt_templates` table only.

| Route | Desired write |
| --- | --- |
| `POST prompt-items` | `prompt_templates` table. |
| `PATCH prompt-items/:id` | single-row `prompt_templates`. |
| `DELETE prompt-items/:id` | `prompt_templates` table. |
| `POST prompt-items/enable` | full `prompt_templates` table toggle. |
| `POST prompt-items/reorder` | `prompt_templates` table. |

No pointer scalar rides along. Projection-field bug: `promptItem` mapped to
`['botPresets']`, so a foreign refresh never reflected the changed `promptTemplate`
— fixed to `['promptTemplate']` in this slice (see
[`../phase-5-projection-range-narrowing/projection-field-bug-fixes.md`](../phase-5-projection-range-narrowing/projection-field-bug-fixes.md)).

Implemented: all five routes moved to `applyTargetedCommandMutation` with
`mutationPath: targeted-collection`, writing only `prompt_templates` through the
named `writePromptTemplatesTable` / `writePromptTemplateRow` repository wrappers
(so the `'promptTemplate'` literal stays out of `routes/commands.ts`, keeping the
EC4 audit scan valid). `patch` is a single-row `writePromptTemplateRow`;
`create`/`delete`/`reorder` rewrite the table. `enable` is a **full-table** toggle,
not the single-row write the table above guessed: `enabled:false` deletes the
whole collection (clears the table) and `enabled:true` ensures it exists, so it
rewrites `prompt_templates` either way. The `promptItem` projection now maps to
`['promptTemplate']`. Proven by `commandCollectionRange.test.ts` (5 prompt-items
tests) plus two `projection.test.ts` assertions (a `promptItem` refresh reships
`promptTemplate`, and the resource-field map check).

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`,
  `server/fastify/src/routes/projection.ts`.
- Durable path: validate message-free `db.json`, write `prompt_templates`
  (single-row for patch; full table for create/delete/enable/reorder) inside the
  revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: global prompt-item repairs are validate-only.

## Done When

- Each route reports `mutationPath: "targeted-collection"` and writes only
  `prompt_templates`, with `dbJsonWriteMs: 0`.
- `promptItem` projection maps to `['promptTemplate']`; a projection test shows a
  foreign refresh reflects the changed prompt items.
- Rowid-stability tests prove all characters and the other collection tables are
  untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
