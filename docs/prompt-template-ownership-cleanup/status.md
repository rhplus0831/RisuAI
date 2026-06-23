# Prompt Template Ownership Cleanup Status

Date: 2026-06-23

This workstream is active planning. No implementation phase has started.

## Snapshot

- Plan state: drafted.
- Current phase: Phase 0 pending.
- Current implementation state:
  - Top-level `promptTemplate` is still the active rendered/editable collection.
  - Server persists that collection through `prompt_templates`.
  - Legacy `botPresets` can carry `promptTemplate` and copy it into the active
    top-level collection when selected/applied.
  - Modern `promptPresets` can carry `promptTemplate` and also apply it into the
    active top-level collection.
  - Prompt Settings edits a local draft backed by `DBState.db.promptTemplate`
    and mirrors relevant fields to selected modern prompt presets.
  - Prompt item commands, projection, hydration, and bridge rollback are still
    top-level prompt-template oriented.
- Current verification state: planning only; no commands have been run for this
  workstream yet.

## Phase Router

| Phase | Status | Purpose |
| --- | --- | --- |
| Phase 0: Contract And Decision | Pending | Lock source-of-truth, precedence, compatibility, and migration behavior. |
| Phase 1: Effective Template Resolver | Pending | Add shared browser/server resolver and use it in runtime read paths. |
| Phase 2: Prompt Preset Commands And Projection | Pending | Move prompt-item edits and hydration toward prompt-preset ownership. |
| Phase 3: Settings UI And Bridge | Pending | Make Prompt Settings and Bot Settings edit selected prompt presets directly. |
| Phase 4: Legacy BotPreset Compatibility | Pending | Retire legacy bot-preset prompt-template apply/copy semantics. |
| Phase 5: Generation Loadout And Cleanup | Pending | Align generation, loadouts, imports/exports, and remaining compatibility paths. |
| Phase 6: Verification And Docs | Pending | Run regression, browser smoke, docs, and closeout. |

## Current Blockers

- Phase 0 decisions must be locked before implementation:
  - final owner of prompt-template edits,
  - top-level `prompt_templates` retention/removal strategy,
  - chat-scoped versus global prompt-preset precedence,
  - legacy bot preset extraction behavior,
  - whether any UI still edits legacy bot-preset templates directly.

## Latest Completed Slice

- Exploration completed through three read-only agents:
  - prompt assembly/runtime,
  - server persistence/projection,
  - frontend settings/storage/loadout.
- This planning folder was created from those findings.

## Compatibility Caveats

- Legacy `botPresets` remain present in storage and UI.
- Legacy `.risu` import/export may still need to preserve
  `botPresets[].promptTemplate`.
- During transition, `DBState.db.promptTemplate` may remain visible as a
  compatibility/effective projection even after ownership moves to
  `promptPresets`.
- Existing tests expect `prompt_templates` writes on some preset apply/select
  operations; those expectations must change phase by phase.
