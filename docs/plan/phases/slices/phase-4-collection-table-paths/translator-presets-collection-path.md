# Translator Presets Collection Path

Status: planned. Tier 4 (includes the Tier-1-listed select route). Depends on the
Phase 0 writer kit.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 translator row and the Tier-1 note on `translator-presets/select`.
- `server/fastify/src/routes/commands.ts` - create (1895), patch (1936), delete
  (1984), select (2050).
- `server/fastify/src/repository.ts` - `translator_presets` table.

## Scope

Edits to the `translatorPresets` collection that currently rewrite all nine
collection tables + all characters. Narrow to the `translator_presets` table +
settings.

| Route (line) | Desired write |
| --- | --- |
| `POST translator-presets` (1895) | `translator_presets` table + settings. |
| `PATCH translator-presets/:id` (1936) | `translator_presets` table + settings. |
| `DELETE translator-presets/:id` (1984) | `translator_presets` table + settings. |
| `POST translator-presets/select` (2050) | `translator_presets` table + settings (`translatorPresetId`/`translatorPrompt`/`translatorMaxResponse`). Reclassified here from Tier 1 — it is **not** settings-only. |

`ensureTranslatorPresetCollection` reassigns the whole array and syncs legacy
fields on **every** call, so even pure field edits become a full one-table
rewrite + an unconditional settings write (not a single-row `UPDATE`). select
(2050) is included here rather than in the Phase 2 settings-only slice for exactly
this reason.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, full `translator_presets` table
  rewrite + the translator settings scalars, inside the revision/event
  transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event.
- Normalization decision: `ensureTranslatorPresetCollection` reassigns the whole
  array by design, so the one-table rewrite is faithful, not over-broad; the
  cross-family de-dup stays validate-only.

## Done When

- All four routes report `mutationPath: "targeted-collection"` and write only
  `translator_presets` + settings, with `dbJsonWriteMs: 0`.
- Rowid-stability tests prove all characters and the other eight collection
  tables are untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
