# Prompt Template Ownership Cleanup Status

Date: 2026-06-23

This workstream has completed the runtime resolver slice and the prompt
preset-owner-aware prompt item command/projection/hydration slice. Editor
visual ownership, legacy apply, and loadout cleanup phases are still pending.

## Snapshot

- Plan state: drafted; Phase 0 decisions recorded.
- Current phase: Phase 2 implemented, with focused command/projection/hydration
  tests passing locally.
- Current implementation state:
  - Browser/server prompt assembly now resolves an effective prompt template
    through modern `promptPresets` before falling back to top-level
    `promptTemplate`.
  - Chat-scoped `generationSettings.promptPresetId` wins for generation reads.
  - A resolved prompt preset without `promptTemplate` disables template
    rendering instead of falling back to stale top-level data.
  - Prompt item commands can now target `promptPresets[].promptTemplate` by
    `promptPresetId`; scoped edits persist through the owning `prompt_presets`
    row and reject stale selected-preset races.
  - Top-level `promptTemplate` remains the legacy command path when
    `promptPresetId` is omitted and a compatibility projection/cache for the
    selected prompt preset.
  - Legacy `botPresets` can carry `promptTemplate` and copy it into the active
    top-level collection when selected/applied.
  - Modern `promptPresets` can carry `promptTemplate` and also apply it into the
    active top-level collection.
  - Prompt Settings edits a local draft backed by `DBState.db.promptTemplate`
    and mirrors relevant fields to selected modern prompt presets.
  - Prompt item projection/hydration derives the selected/requested prompt
    preset body and clears stale compatibility template data when the selected
    prompt preset has no template.
  - Prompt Settings still uses the existing UI layout and local draft; Phase 3
    remains responsible for broader visual/editor ownership cleanup.
- Current verification state: Focused Phase 2 command/projection/hydration
  checks passed; see `latest-verification.md`.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Decision | Decided | Lock source-of-truth, precedence, compatibility, and migration behavior. |
| Phase 1: Effective Template Resolver | Implemented | Add shared browser/server resolver and use it in runtime read paths. |
| Phase 2: Prompt Preset Commands And Projection | Implemented | Move prompt-item edits and hydration toward prompt-preset ownership. |
| Phase 3: Settings UI And Bridge | Pending | Make Prompt Settings and Bot Settings edit selected prompt presets directly. |
| Phase 4: Legacy BotPreset Compatibility | Pending | Retire legacy bot-preset prompt-template apply/copy semantics. |
| Phase 5: Generation Loadout And Cleanup | Pending | Align generation, loadouts, imports/exports, and remaining compatibility paths. |
| Phase 6: Verification And Docs | Pending | Run regression, browser smoke, docs, and closeout. |

## Current Blockers

- No Phase 1 blocker is known.
- No Phase 2 blocker is known.

## Latest Completed Slice

- Exploration completed through three read-only agents:
  - prompt assembly/runtime,
  - server persistence/projection,
  - frontend settings/storage/loadout.
- This planning folder was created from those findings.
- Phase 1 worker implementation added shared effective prompt template
  resolution for browser/server runtime reads and focused precedence tests.
- Focused resolver parity fix threads chat-scoped prompt preset IDs into server
  author-note defaults and keeps Prompt Settings warnings pointed at the
  editable top-level draft template until Phase 3.
- Phase 2 worker extended prompt item commands with optional `promptPresetId`,
  scoped durable writes to `prompt_presets`, owner-aware projection/hydration,
  bridge stale-owner dropping for debounced row edits, and captured-owner guards
  for create/delete/reorder/enable command construction plus rollback.

## Compatibility Caveats

- Legacy `botPresets` remain present in storage and UI.
- Legacy `.risu` import/export may still need to preserve
  `botPresets[].promptTemplate`.
- During transition, `DBState.db.promptTemplate` may remain visible as a
  compatibility/effective projection even after ownership moves to
  `promptPresets`.
- Existing tests expect `prompt_templates` writes on some preset apply/select
  operations; those expectations must change phase by phase.
