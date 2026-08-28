# Phase 5: Settings, Profiles, Authoring, And Catalogs

Status: Pending; depends on Phases 0-4.

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
