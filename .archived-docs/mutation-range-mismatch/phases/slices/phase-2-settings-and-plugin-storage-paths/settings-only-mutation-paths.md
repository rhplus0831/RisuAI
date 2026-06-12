# Settings-Only Mutation Paths

Status: implemented (`56ddd865` on `fastify`). Tier 1. The six routes route onto
`applyTargetedCommandMutation` (`targeted-settings`) and write only the settings
row via `writeSettingsOnly(extractSettings(database))`; the memory group also
co-writes `hypa_v3_presets` when the patch carries `hypaV3Presets`. The dropped
`characters/reorder` and `lorebooks/:id/select` global normalizations are
recorded as validate-only below.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 1.
- `server/fastify/src/routes/commands.ts` - the routes below.
- `server/fastify/src/repository.ts` - `writeSettingsOnly`.
- `server/fastify/src/routes/projection.ts` - Phase 5 `moduleEnabled`,
  `globalLorebook`, and prompt fallback resources.

## Scope

Before implementation, each route changed one (or a few) settings-row scalar but
rewrote every character row + every chat row + all nine collection tables (most
also loaded every message). The implemented path writes a single `UPDATE
settings` via `mutationPath: targeted-settings`.

| Route | Desired write | Notes |
| --- | --- | --- |
| `PATCH characters/reorder` | `UPDATE settings` only | sole write is `characterOrder` (a settings scalar); reorder edits presentation order, not `characters` table positions. |
| `PATCH prompt-settings` | `UPDATE settings` only | all 21 `PROMPT_SETTINGS_KEYS` are settings scalars. Phase 5 routes `prompt` to full/sprawling fallback. |
| `POST plugins/provider` | `UPDATE settings` only | `currentPluginProvider` scalar. |
| `POST modules/enable` | `UPDATE settings` only | `enabledModules` scalar. Phase 5 emits the narrow `moduleEnabled` projection. |
| `PATCH settings/:group` | `UPDATE settings` (8 of 9 groups) | the `memory` group additionally rewrites `hypa_v3_presets` only when the patch carries `hypaV3Presets`. It came into this slice from the Phase 1 floor; the high-severity core was rewriting every character row for a settings patch. |
| `POST lorebooks/:lorebookId/select` | `UPDATE settings` only (`loreBookPage`) | accepted dropping the `ensureAllChildLorebooks` repairs to validate-only (Prerequisite 2). |

translator-presets/select is listed in the audit's Tier 1 but is not
settings-only — it also rewrites the `translator_presets` table — so it is
handled with the translator family in
[`../phase-4-collection-table-paths/translator-presets-collection-path.md`](../phase-4-collection-table-paths/translator-presets-collection-path.md).

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, then `writeSettingsOnly` inside
  the revision/event transaction; for settings/:group `memory`, conditionally
  add the `hypa_v3_presets` table rewrite.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event, unchanged from the generic path; provider secret handling/masking on
  settings patches is preserved.
- Rollback/resync behavior: `db.json` written only after the SQLite commit.
- Normalization decision: lorebooks/:id/select drops global child-lorebook
  normalization to validate-only (recorded here).

## Done When

- Each route reports `mutationPath: "targeted-settings"` (settings/:group
  `memory` may additionally show the `hypa_v3_presets` write) with
  `dbJsonWriteMs: 0`.
- Rowid-stability tests prove no character, chat, or collection rowid changed
  (except the `hypa_v3_presets` table for the `memory` group).
- The dropped lorebook normalization is recorded as an accepted decision.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
