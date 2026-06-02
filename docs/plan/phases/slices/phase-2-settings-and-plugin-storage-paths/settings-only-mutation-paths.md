# Settings-Only Mutation Paths

Status: planned. Tier 1. Depends on the Phase 0 writer kit (`writeSettingsOnly`)
and review gates.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 1.
- `server/fastify/src/routes/commands.ts` - the routes below.
- `server/fastify/src/repository.ts` - `writeSettingsOnly`.
- `server/fastify/src/routes/projection.ts` - `module` and `lorebook` resources
  (Phase 5 co-fixes).

## Scope

Each route changes one (or a few) settings-row scalar but currently rewrites
every character row + every chat row + all nine collection tables (most also load
every message). Narrow the write to a single `UPDATE settings` via a bespoke
settings-only mutation modeled on `applyCharacterSelectionCommandMutation`
(`mutationPath: targeted-settings`).

| Route (line) | Desired write | Notes |
| --- | --- | --- |
| `PATCH characters/reorder` (2457) | `UPDATE settings` only | sole write is `characterOrder` (a settings scalar); reorder edits presentation order, not `characters` table positions. |
| `PATCH prompt-settings` (1424) | `UPDATE settings` only | all 21 `PROMPT_SETTINGS_KEYS` are settings scalars. `prompt` projection ships the wrong field — Phase 5 co-fix. |
| `POST plugins/provider` (3966) | `UPDATE settings` only | `currentPluginProvider` scalar. |
| `POST modules/enable` (3708) | `UPDATE settings` only | `enabledModules` scalar. Needs the narrow `moduleEnabled` projection (Phase 5); the shared `module` resource stays broad otherwise. |
| `PATCH settings/:group` (1074) | `UPDATE settings` (8 of 9 groups) | the `memory` group additionally rewrites `hypa_v3_presets` only when the patch carries `hypaV3Presets`. Already `message-free`; this is the high-severity core (it rewrites every character row for a settings patch). |
| `POST lorebooks/:lorebookId/select` (3459) | `UPDATE settings` only (`loreBookPage`) | must explicitly accept dropping the `ensureAllChildLorebooks` repairs it currently persists across characters/chats/modules (Prerequisite 2). |

translator-presets/select (2050) is listed in the audit's Tier 1 but is not
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
