# Presets Collection Path

Status: implemented. Tier 4. Uses the Phase 0 writer kit.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 presets row.
- `server/fastify/src/routes/commands.ts` - create (1105), patch (1143), delete
  (1185), copy (1251), select (1299), import (1341), reorder (1379).
- `server/fastify/src/repository.ts` - `bot_presets` and `prompt_templates`
  tables.

## Scope

Edits to the `bot_presets` collection that currently rewrite all nine collection
tables + all characters. Narrow to the `bot_presets` table (+ settings
`botPresetsId`).

| Route (line) | Desired write |
| --- | --- |
| `POST presets` (1105) | `bot_presets` table (+ settings `botPresetsId`). |
| `PATCH presets/:id` (1143) | single-row `bot_presets`. |
| `DELETE presets/:id` (1185) | `bot_presets` table (+ settings `botPresetsId`). With `apply=true`: also the `prompt_templates` table + ~73 settings scalars (via `applyPreset` writing `promptTemplate`). |
| `POST presets/:id/copy` (1251) | `bot_presets` table. |
| `POST presets/select` (1299) | `bot_presets` table (+ settings `botPresetsId`). With `apply=true`: also `prompt_templates` + ~73 settings scalars. |
| `POST presets/import` (1341) | `bot_presets` table. |
| `POST presets/reorder` (1379) | `bot_presets` table. |

The verifier flagged select/delete with `apply=true` as wider than the
classifier's single-table claim: `applyPreset` writes `promptTemplate` (a
collection) plus ~73 settings scalars. Those two routes are two-table + settings;
the rest are one table (+ pointer).

Implemented: all seven routes moved to `applyTargetedCommandMutation` with
`mutationPath: targeted-collection`. `patch` is a single-row
`writeSingleCollectionRow`; create/copy/import rewrite only `bot_presets`;
`reorder` rewrites `bot_presets` and co-writes settings via `writeSettingsOnly`
only when the reorder moved the selected `botPresetsId` index; `delete` always
rewrites `bot_presets` (the splice shifts positions) and co-writes settings when
the pointer changed; `select` rewrites `bot_presets` only when the
`saveCurrent` snapshot edits it. For `apply=true` (select default, delete opt-in),
the selected preset's `promptTemplate` collection is co-written through the named
`writePromptTemplatesTable` repository wrapper (so the literal `'promptTemplate'`
never enters `routes/commands.ts`, keeping the EC4 audit scan valid) — but only
when `presetAppliesPromptTemplate` confirms the preset carries one — alongside the
applied settings scalars. Proven by `commandCollectionRange.test.ts` (8 presets
tests: targeted path + exact `writtenTables` for each shape including the
two-table + settings apply case, character/chat rowid stability, and bot_presets
rowid stability for the single-row patch).

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, write `bot_presets` (single-row
  for patch; full table for create/delete/copy/select/import/reorder), settings
  `botPresetsId` when it changed, and for `apply=true` additionally
  `prompt_templates` + the applied settings scalars — inside the revision/event
  transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: global preset repairs are validate-only.

## Done When

- Each route reports `mutationPath: "targeted-collection"` and writes only the
  documented tables; select/delete with `apply=true` write exactly
  `bot_presets` + `prompt_templates` + settings.
- Rowid-stability tests prove all characters and the unrelated collection tables
  are untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
