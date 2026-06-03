# Phase 2: Settings And Plugin-Storage Paths

Status: implemented (`56ddd865` on `fastify`). The six Tier-1 settings-scalar
routes now report `targeted-settings` (one `UPDATE settings`, plus the
`hypa_v3_presets` co-write for the memory group) and the three Tier-2
plugin-storage routes report `targeted-plugin-storage` (only
`plugin_custom_storage`). The exit-criteria proofs landed in
`commandSettingsAndPluginStorageRange.test.ts`.

Goal: narrow the two cleanest high-ratio tiers. Tier 1 becomes one
`UPDATE settings`. Tier 2 becomes a key write on `plugin_custom_storage`. Their
projections are already safe or intentionally sprawling.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) - Tier 1
  and Tier 2.
- `server/fastify/src/routes/commands.ts` - the Tier-1 and Tier-2 routes.
- `server/fastify/src/commands/mutations.ts` - target paths.
- `server/fastify/src/repository.ts` - `writeSettingsOnly`,
  `writePluginStorageKey` / `deletePluginStorageKey`, `plugin_custom_storage`
  (lines ~167-176).
- [`slices/phase-0-baseline-foundations/normalization-scope-policy.md`](slices/phase-0-baseline-foundations/normalization-scope-policy.md) -
  the validate-only / settings co-write contract (Prerequisites 2-3) and the
  shared `assertOnlyRowsWritten` rowid-stability helper this phase's slices use.

## Slices

- [`settings-only-mutation-paths.md`](slices/phase-2-settings-and-plugin-storage-paths/settings-only-mutation-paths.md) -
  Tier 1: characters/reorder, prompt-settings, plugins/provider, modules/enable,
  settings/:group, lorebooks/:id/select. translator-presets/select is
  reclassified to the Phase 4 translator family because it also writes the
  `translator_presets` table.
- [`plugin-storage-key-writers.md`](slices/phase-2-settings-and-plugin-storage-paths/plugin-storage-key-writers.md) -
  Tier 2: plugin-storage put/delete/bulk → only `plugin_custom_storage`.

## Exit Criteria

- The six Tier-1 settings-only routes issue `UPDATE settings` and nothing else
  (settings/:group's `memory` group additionally rewrites `hypa_v3_presets` only
  when the patch carries `hypaV3Presets`); rowid-stability tests show no
  character/chat/collection rowid changed.
- The three plugin-storage routes write only `plugin_custom_storage` (single-key
  upsert/delete; bulk = clear + reinsert) with `dbJsonWriteMs: 0`.
- lorebooks/:id/select explicitly accepts dropping the global
  `ensureAllChildLorebooks` normalization (Prerequisite 2), recorded in the slice.
- modules/enable now emits the Phase 5 `moduleEnabled` projection resource.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
