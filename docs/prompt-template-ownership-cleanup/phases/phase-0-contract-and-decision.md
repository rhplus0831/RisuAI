# Phase 0: Contract And Decision

Status: decided.

Goal: lock the prompt-template ownership contract before code starts moving.

## Scope

- Decide whether top-level `prompt_templates` remains as:
  - a temporary effective projection/cache,
  - a permanent compatibility mirror, or
  - a removed table/collection.
- Decide that normal prompt template editing uses selected `promptPresetsId`.
- Define precedence between:
  - chat-scoped `generationSettings.promptPresetId`,
  - global `promptPresetsId`,
  - legacy `botPresetsId`,
  - top-level compatibility `promptTemplate`.
- Define legacy bot preset behavior:
  - import preserves `botPresets[].promptTemplate`,
  - extraction creates or reuses prompt preset rows,
  - selection does not silently overwrite modern prompt preset templates.
- Define disabled, empty, missing, and unloaded prompt-template states.
- Add or update contract tests that document current behavior before migration.

## Decision Record

Decision date: 2026-06-23.

### Durable Owner

- `promptPresets[].promptTemplate` is the durable owner for normal prompt
  template data.
- Top-level `DBState.db.promptTemplate`, server `database.promptTemplate`, and
  the `prompt_templates` table remain during the migration only as an effective
  projection/cache for compatibility with existing assembly, hydration, and
  editor code.
- The top-level field does not become a permanent source of truth. Later phases
  may either remove the durable top-level write path or leave a compatibility
  mirror, but only after owner-aware reads and writes have moved to prompt
  presets.
- Phase 0 does not remove `prompt_templates`; it defines how later phases should
  demote it.

### Editing Contract

- Normal Prompt Settings editing mutates the selected modern prompt preset row,
  using `promptPresetsId` to identify the selected row and a stable
  `promptPresetId` for server commands.
- Prompt item create, update, delete, reorder, and enable/disable operations
  should become prompt-preset-scoped in Phase 2. Commands should carry
  `promptPresetId` and reject stale edits if selection changed before the
  command reached the server.
- Legacy `botPresets` can still be edited by explicit legacy UI/import/export
  paths. Direct legacy bot-preset prompt-template editing is not the normal
  Prompt Settings behavior.
- The top-level compatibility `promptTemplate` may be refreshed from the owner
  for compatibility, but normal edits should not treat it as the edited row.

### Rendering Precedence

When rendering for chat generation, resolve the effective prompt template in
this order:

1. `currentChat.generationSettings.promptPresetId`, resolved by id against
   `promptPresets`.
2. No fallback when chat generation settings are configured but the prompt
   preset id is missing, stale, or unresolved. Generation should report
   incomplete chat generation settings.

When rendering or editing outside a chat-scoped generation context, resolve the
effective prompt template in this order:

1. Global selected `promptPresetsId`.
2. Explicit legacy compatibility action, such as applying or extracting a legacy
   bot preset.
3. Last-resort import/recovery compatibility only, if a top-level
   `promptTemplate` exists without a modern owner.

`botPresetsId` and top-level `promptTemplate` do not win over a resolved modern
prompt preset. Top-level `promptTemplate` is the materialized effective body of
the winning prompt preset during the transition, not an independent selector.

### Legacy Bot Presets

- Import preserves `botPresets[].promptTemplate` so old saves and exports remain
  readable.
- Extraction creates or reuses modern prompt preset rows that carry the legacy
  template data. If equivalent prompt preset reuse is added, equivalence must be
  based on the extracted prompt-preset payload, not on the mutable top-level
  cache.
- Selecting a legacy bot preset should not silently overwrite modern
  `promptPresets[].promptTemplate` rows.
- Legacy bot preset selection may continue to apply explicitly supported legacy
  model and prompt scalars, but making its template the active modern template
  requires an explicit extraction/apply-as-prompt-preset action.
- Legacy export may preserve old fields, but normal live app state should have a
  modern prompt preset representing any template the user intends to edit or use
  for generation.

### Prompt Template State Semantics

- Loaded enabled template: the resolved owner has `promptTemplate` as an array.
  An empty array is still an enabled structured template; normalization may add
  the implicit `postEverything` card for rendering.
- Loaded disabled template: the resolved owner is loaded and explicitly has no
  prompt template, or has `promptTemplate: null` from a compatibility payload.
  Rendering uses the non-template format-order path, except for utility-bot
  override behavior.
- Missing top-level `DBState.db.promptTemplate` alone is not disabled. Bootstrap
  and projection may intentionally strip it, so hydration state or owner-loaded
  state decides whether the template is unloaded or disabled.
- Missing or stale prompt preset id is an error for chat generation, not a
  reason to fall back to global, legacy, or top-level data.
- Unloaded prompt preset body should block, hydrate, or clearly report
  unavailable state instead of treating absence as an empty or disabled
  template.

### Contract Test TODOs

- Assembly/resolver: chat-scoped `generationSettings.promptPresetId` beats
  global `promptPresetsId`, legacy `botPresetsId`, and stale top-level
  `promptTemplate`.
- Assembly/resolver: missing or stale chat-scoped prompt preset id reports
  incomplete generation settings instead of falling back.
- Settings/editor: prompt item writes name `promptPresets[].promptTemplate` as
  the owner and include a stable `promptPresetId`.
- Settings/editor: stale prompt-item edits are rejected or routed to the
  original prompt preset when selection changes.
- Legacy compatibility: legacy bot preset selection does not overwrite modern
  prompt preset templates unless an explicit extraction/apply action requests
  that behavior.
- Hydration/projection: absent top-level `promptTemplate` after bootstrap means
  unloaded, loaded `[]` means enabled empty, and loaded missing/null owner data
  means disabled.
- Loadout: split prompt preset ids apply before legacy `presetName`, and legacy
  fallback cannot restore a stale top-level template when a prompt preset id is
  present.

## Out Of Scope

- Runtime resolver implementation.
- Prompt item command rewrites.
- Prompt Settings UI changes.
- Removing any compatibility fields.

## Anchors

- `src/ts/presetSplit.ts`
- `src/ts/storage/database.svelte.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `server/fastify/src/commands/presets.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/projection.ts`
- `src/ts/server/promptTemplateHydration.ts`
- `src/ts/loadout.ts`

## Exit Criteria

- Plan decisions are recorded in `../plan.md` or a companion decision note.
- Tests or test TODOs name the expected owner and precedence.
- The team can answer: "When rendering, which prompt template wins?"
- The team can answer: "When editing, which row is mutated?"
- No implementation phase depends on an unresolved ownership question.

## Validation

```bash
pnpm exec vitest run src/ts/presetSplit.test.ts src/ts/storage/database.svelte.test.ts src/ts/loadout.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/projection.test.ts
git diff --check
```

## Risks

- Leaving precedence vague will cause later phases to reintroduce top-level
  ownership through convenience helpers.
- Treating missing `promptTemplate` as disabled can corrupt lazy projection
  behavior.
- Direct legacy bot-preset editing would conflict with the cleanup goal.
