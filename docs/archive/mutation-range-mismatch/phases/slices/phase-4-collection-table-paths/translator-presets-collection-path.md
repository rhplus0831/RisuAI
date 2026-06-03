# Translator Presets Collection Path

Status: implemented. Tier 4 (includes the Tier-1-listed select route). Uses the
Phase 0 writer kit.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 4 translator row and the Tier-1 note on `translator-presets/select`.
- `server/fastify/src/routes/commands.ts` - create, patch, delete, select.
- `server/fastify/src/repository.ts` - `translator_presets` table.

## Scope

Before implementation, edits to the `translatorPresets` collection rewrote all
nine collection tables + all characters. The implemented path writes the
`translator_presets` table + settings.

| Route | Desired write |
| --- | --- |
| `POST translator-presets` | `translator_presets` table + settings. |
| `PATCH translator-presets/:id` | `translator_presets` table + settings. |
| `DELETE translator-presets/:id` | `translator_presets` table + settings. |
| `POST translator-presets/select` | `translator_presets` table + settings (`translatorPresetId`/`translatorPrompt`/`translatorMaxResponse`). Reclassified here from Tier 1 — it is not settings-only. |

`ensureTranslatorPresetCollection` reassigns the whole array and syncs legacy
fields on every call, so even pure field edits become a full one-table
rewrite + an unconditional settings write (not a single-row `UPDATE`). select
translator-presets/select is included here rather than in the Phase 2
settings-only slice for exactly this reason.

Implemented: all four routes moved to `applyTargetedCommandMutation` with
`mutationPath: targeted-collection`, each ending in the shared
`writeTranslatorPresetMutation` helper — a full `writeSingleCollectionTable(db,
'translatorPresets', …)` rewrite plus an unconditional `writeSettingsOnly`.
Because `ensureTranslatorPresetCollection` always re-runs
`syncSelectedTranslatorPresetToLegacyFields` (re-syncing `translatorPrompt` /
`translatorMaxResponse` from the selected preset and normalizing
`translatorPresetId`), the settings write is faithful, not over-broad. Proven by
`commandCollectionRange.test.ts` (4 translator tests: targeted path + exact
`writtenTables` `['settings','translator_presets']` + character/chat rowid
stability + the legacy-scalar re-sync on patch/select).

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
