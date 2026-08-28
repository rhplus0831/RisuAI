# Phase 5: Settings, Profiles, Authoring, And Catalogs

Status: Complete on 2026-08-29; Phases 0-4 satisfied.

## Objective

Audit whether settings and authoring tests protect durable user intent,
validation, stable identity, reordering, upload/import races, and accessible
editing outcomes across the application's largest UI families.

## Scope

- Settings shell, display/input/hotkey/request-history pages, shared settings
  controls, localization, and debounced persistence.
- Model/profile/preset lists and editors as UI; provider wire/secret semantics
  belong to Phase 7.
- Personas, characters, chat-specific configuration, lorebook/script authoring,
  modules/plugins authoring surfaces, and Agent Preset UI.
- Realm/catalog browsing, character cards as authoring/UI, mobile character
  surfaces, grids, media pickers, and upload state.
- Dirty-field preservation, stable ID re-resolution, reorder, optimistic paint,
  rollback, target disappearance, and latest-operation-wins behavior.

Primary discovery guides:

- [`settings-profiles-and-extensions.md`](../../../tests/settings-profiles-and-extensions.md)
- [`character-content-memory-and-catalogs.md`](../../../tests/character-content-memory-and-catalogs.md)

## Audit Questions

- Do tests prove durable accepted/queued/failed outcomes, or only local draft
  mutation?
- Are validation, masking, stable IDs, reordering, and sibling preservation
  asserted after asynchronous settlement?
- Do mounted tests inspect accessible user outcomes rather than internal stores
  or markup shape only?
- Are giant settings/editor suites cohesive, or do they hide independent
  failures behind shared mocks and setup?
- Are upload/import/fetch callbacks fenced against owner changes and stale
  completion?

## Required Outputs

- Per-surface contract/disposition map and cross-reference to Phase 3 durable
  bridges.
- Findings for internal-only UI assertions, duplicate editor matrices,
  source-text policy checks, stale async ownership, masked-secret false
  confidence, and missing rendered rollback.
- Split/merge proposals for mega-suites based on failure ownership, not file size
  alone.
- Recorded Phase 7/11 seams for provider semantics and import bytes/atomicity.

## Exit Criteria

- Every Phase 5 test has a disposition and named authoring/settings contract.
- Unique dirty-state, stable-target, reorder, upload, validation, and
  accessibility behavior remains protected.
- Critical/High data-loss or credential-display findings are resolved or routed
  with explicit owners.
- Removed/merged tests have mounted or durable replacement proof where required.
- Count deltas and residual composition gaps are recorded.

## Validation

- Focused settings, authoring, catalog, and bridge tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm coverage:ui-map` for mapped catalog/sidebar owners
- Relevant server command tests when durable adapters change
- Relevant browser smoke for composed authoring journeys
- `pnpm check`
- `pnpm format:check`
- `git diff --check`

## Completed Audit Record

Phase 5 opened with 96 category-E owners and 1,011 cases. All opening cases
passed before remediation. Product-risk review moved the 28-case Realm hub
security owner to L, the 78-case Fastify lorebook and five-case Agent lorebook
runtime owners to F, and the 21-case PNG/CharX byte-format owner to K. A new
one-case mounted PersonaSettings owner and eleven counterexamples brought the
completed review record to 97 files and 1,023 cases.

### Contract And Disposition Map

Every file-level contract and disposition is recorded in `inventory.json`.
The grouped map retains separate failure ownership rather than merging by page
name or suite size.

| Owner family | Live files / cases | Protected contract | Disposition |
| --- | ---: | --- | --- |
| Settings shell, shared controls, loadouts, and server parity | 33 / 325 | Route/control selection, validation, drafts, settings grouping, rollback, and accessible editing | Keep |
| Model profiles, presets, credentials, and pickers | 19 / 154 | Stable profile identity, secret display, reorder, selection, runtime defaults, and rejected-operation recovery | Keep |
| Persona and character authoring/media | 15 / 125 | Stable owner resolution, icon/media freshness, folder/open behavior, projection, and rollback | 14 Keep / 1 Reclassify to K |
| Lorebook authoring and activation | 6 / 128 | Entry identity, import/edit guards, rendered authoring, and runtime activation | 4 Keep / 2 Reclassify to F |
| Realm and catalog browsing/actions | 6 / 88 | Filtering, locale, account ownership, removal/reporting, lifecycle, and hub security | 5 Keep / 1 Reclassify to L |
| Display, color, notification, and settings media | 6 / 64 | Visible toggles, color import, settings data, accessibility, and preview classification | Keep |
| Module and plugin authoring | 5 / 71 | Module assets/lore/scripts, import freshness, plugin lifecycle, and durable authoring state | Keep |
| Hotkey, input-hook, and script authoring | 3 / 14 | Modifier patches, profile selection, input-hook drafts, and script identity | Keep |
| Specialized authoring helpers | 4 / 54 | NanoGPT UI, field mirrors, color import planning, and setting utility semantics | Keep |

The current category-E set is 93 owners and 891 cases: 68 DOM owners with 728
cases, 22 Node owners with 142 cases, one Svelte+Node owner with two cases, and
two Fastify owners with 19 cases. Together with the four outgoing owners, the
review adds 92 new Keep and four Reclassify decisions; the previously reviewed
persona display-name owner remains Keep. Live totals are therefore 298 Keep,
15 Reclassify, and 387 Pending across 700 tracked files.

### Findings And Remediation

- `TSA-P05-001` and `TSA-P05-002` recover rejected model-preset selection and
  dynamic provider catalog requests without permanently busy settings UI.
- `TSA-P05-003` normalizes persisted module media preview extensions;
  `TSA-P05-004` adds the missing mounted PersonaSettings owner and guards a
  disappeared selected persona.
- `TSA-P05-005` fences catalog action settlements after unmount;
  `TSA-P05-006` adds the explicit Realm non-owner removal counterexample.
- `TSA-P05-007` resolves mobile character rows by stable ID;
  `TSA-P05-008` records all four product-risk category corrections.
- `TSA-P05-009` exercises every hotkey modifier authoring path;
  `TSA-P05-010` proves persona icon completion rejects a replaced owner.
- `TSA-P05-011` replaces formatting-sensitive icon label checks with a modern
  Svelte AST oracle; `TSA-P05-012` records why the full evidence layers remain.
- `TSA-P00-002` is closed as a suspected current defect after isolated, exact,
  and complete-load passes with an explicit production reassertion path.
- `TSA-P05-013` routes immediate stale-asset cleanup to Phase 11, representative
  settings/restore/browser composition to Phase 13, and a mandatory final
  residual decision to Phase 14. Current owners remain because their bounded
  contracts are distinct.

All demonstrated High authoring/identity defects are fixed. The deferred asset
and composition item has explicit owners and does not claim broader browser or
transactional proof than the current suite provides.

### Validation Summary

The exact completed frontend set passed 898/898 across 93 owners in 28.15s,
and the exact Fastify set passed 125/125 across four owners in 3.50s. The full
frontend universe passed 6,705/6,705 across 539 files in 72.38s; full Fastify
passed 3,316 cases across 154 files with one intentional direct-only skip.

The two performance owners passed 6/6. `coverage:ui-map` passed 206/206 with
14.83% statements, 9.46% branches, 18.11% functions, and 14.43% lines.
`svelte-check` reported zero errors and zero warnings, the production smoke
build passed in 10.41s with existing allowed diagnostics, and inventory,
affected-selection, formatting, and diff gates passed. No browser owner changed;
the missing composed authoring journey is explicitly retained in
`TSA-P05-013` rather than inferred from unrelated smoke coverage.
