# Prompt Template Ownership Cleanup Status

Date: 2026-06-23

This workstream has completed the first narrow runtime resolver slice. Command,
projection, editor, legacy apply, and loadout cleanup phases are still pending.

## Snapshot

- Plan state: drafted; Phase 0 decisions recorded.
- Current phase: Phase 1 implemented, with focused resolver parity fixes
  validated locally.
- Current implementation state:
  - Browser/server prompt assembly now resolves an effective prompt template
    through modern `promptPresets` before falling back to top-level
    `promptTemplate`.
  - Chat-scoped `generationSettings.promptPresetId` wins for generation reads.
  - A resolved prompt preset without `promptTemplate` disables template
    rendering instead of falling back to stale top-level data.
  - Top-level `promptTemplate` is still the active editable collection.
  - Server persists that collection through `prompt_templates`.
  - Legacy `botPresets` can carry `promptTemplate` and copy it into the active
    top-level collection when selected/applied.
  - Modern `promptPresets` can carry `promptTemplate` and also apply it into the
    active top-level collection.
  - Prompt Settings edits a local draft backed by `DBState.db.promptTemplate`
    and mirrors relevant fields to selected modern prompt presets.
  - Prompt item commands, projection, hydration, and bridge rollback are still
    top-level prompt-template oriented.
- Current verification state: Focused Phase 1 resolver and author-note parity
  checks passed; see `latest-verification.md`.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Decision | Decided | Lock source-of-truth, precedence, compatibility, and migration behavior. |
| Phase 1: Effective Template Resolver | Implemented | Add shared browser/server resolver and use it in runtime read paths. |
| Phase 2: Prompt Preset Commands And Projection | Pending | Move prompt-item edits and hydration toward prompt-preset ownership. |
| Phase 3: Settings UI And Bridge | Pending | Make Prompt Settings and Bot Settings edit selected prompt presets directly. |
| Phase 4: Legacy BotPreset Compatibility | Pending | Retire legacy bot-preset prompt-template apply/copy semantics. |
| Phase 5: Generation Loadout And Cleanup | Pending | Align generation, loadouts, imports/exports, and remaining compatibility paths. |
| Phase 6: Verification And Docs | Pending | Run regression, browser smoke, docs, and closeout. |

## Current Blockers

- No Phase 1 blocker is known.
- Phase 2 must still decide exact command payload/rollback mechanics for
  prompt-preset-scoped prompt item edits.

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

## Compatibility Caveats

- Legacy `botPresets` remain present in storage and UI.
- Legacy `.risu` import/export may still need to preserve
  `botPresets[].promptTemplate`.
- During transition, `DBState.db.promptTemplate` may remain visible as a
  compatibility/effective projection even after ownership moves to
  `promptPresets`.
- Existing tests expect `prompt_templates` writes on some preset apply/select
  operations; those expectations must change phase by phase.
